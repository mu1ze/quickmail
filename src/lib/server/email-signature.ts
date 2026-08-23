import type { D1Database } from '@cloudflare/workers-types';
import {
	MAX_SAVED_SIGNATURES,
	parseAccountSignature,
	parseMailboxSignature,
	parseSignatureName,
	resolveSignatureBody,
	type SavedSignature
} from '$lib/email-signature';
import type { MailAddress } from '$lib/types';

type SignatureRow = {
	id: string;
	user_id: string;
	name: string;
	body: string;
	is_default: number;
	position: number;
};

function mapSignature(row: SignatureRow): SavedSignature {
	return {
		id: row.id,
		name: row.name,
		body: row.body,
		is_default: row.is_default === 1,
		position: row.position
	};
}

async function loadSignatureRows(db: D1Database, userId: string): Promise<SavedSignature[]> {
	const { results } = await db
		.prepare(
			`SELECT id, user_id, name, body, is_default, position
			 FROM signatures WHERE user_id = ?
			 ORDER BY position ASC, created_at ASC`
		)
		.bind(userId)
		.all<SignatureRow>();
	return (results ?? []).map(mapSignature);
}

async function syncAccountColumn(db: D1Database, userId: string, signatures: SavedSignature[]) {
	const body =
		signatures.find((signature) => signature.is_default)?.body ?? signatures[0]?.body ?? '';
	await db
		.prepare('UPDATE users SET email_signature = ? WHERE id = ?')
		.bind(body, userId)
		.run();
}

function nextUnusedName(existing: string[], base: string): string {
	if (!existing.includes(base)) return base;
	for (let n = 2; n <= MAX_SAVED_SIGNATURES + 1; n++) {
		const candidate = `${base} ${n}`;
		if (!existing.includes(candidate)) return candidate;
	}
	return base;
}

/** Move a lone account/mailbox sign-off into the named library once. */
async function ensureMigrated(db: D1Database, userId: string): Promise<void> {
	const countRow = await db
		.prepare('SELECT COUNT(*) AS n FROM signatures WHERE user_id = ?')
		.bind(userId)
		.first<{ n: number }>();
	if ((countRow?.n ?? 0) > 0) return;

	const user = await db
		.prepare('SELECT email_signature FROM users WHERE id = ?')
		.bind(userId)
		.first<{ email_signature: string }>();
	const { results: addressRows = [] } = await db
		.prepare(
			`SELECT id, label, address, signature FROM addresses
			 WHERE user_id = ? AND signature IS NOT NULL AND trim(signature) != ''`
		)
		.bind(userId)
		.all<{ id: string; label: string | null; address: string; signature: string }>();

	const inserts: SavedSignature[] = [];
	const account = (user?.email_signature ?? '').trim();
	if (account) {
		inserts.push({
			id: crypto.randomUUID(),
			name: 'Signature',
			body: parseAccountSignature(account),
			is_default: true,
			position: 0
		});
	}

	for (const address of addressRows) {
		if (inserts.length >= MAX_SAVED_SIGNATURES) break;
		let body = '';
		try {
			body = parseMailboxSignature(address.signature) ?? '';
		} catch {
			continue;
		}
		if (!body) continue;
		const match = inserts.find((signature) => signature.body === body);
		if (match) continue;
		const base = parseSignatureName(address.label || address.address.split('@')[0] || 'Mailbox');
		inserts.push({
			id: crypto.randomUUID(),
			name: nextUnusedName(inserts.map((signature) => signature.name), base),
			body,
			is_default: inserts.length === 0,
			position: inserts.length
		});
	}

	if (inserts.length === 0) return;

	const statements = inserts.map((signature) =>
		db
			.prepare(
				`INSERT INTO signatures (id, user_id, name, body, is_default, position)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.bind(
				signature.id,
				userId,
				signature.name,
				signature.body,
				signature.is_default ? 1 : 0,
				signature.position
			)
	);

	for (const address of addressRows) {
		let body = '';
		try {
			body = parseMailboxSignature(address.signature) ?? '';
		} catch {
			continue;
		}
		const match = inserts.find((signature) => signature.body === body);
		if (!match) continue;
		statements.push(
			db
				.prepare('UPDATE addresses SET signature_id = ?, signature = NULL WHERE id = ? AND user_id = ?')
				.bind(match.id, address.id, userId)
		);
	}

	await db.batch(statements);
	await syncAccountColumn(db, userId, inserts);
}

export async function listSignatures(db: D1Database, userId: string): Promise<SavedSignature[]> {
	await ensureMigrated(db, userId);
	return loadSignatureRows(db, userId);
}

export async function getEmailSignature(db: D1Database, userId: string): Promise<string> {
	const signatures = await listSignatures(db, userId);
	return signatures.find((signature) => signature.is_default)?.body ?? signatures[0]?.body ?? '';
}

export async function getSignatureForUser(
	db: D1Database,
	userId: string,
	signatureId: string
): Promise<SavedSignature | null> {
	await ensureMigrated(db, userId);
	const row = await db
		.prepare(
			`SELECT id, user_id, name, body, is_default, position
			 FROM signatures WHERE id = ? AND user_id = ?`
		)
		.bind(signatureId, userId)
		.first<SignatureRow>();
	return row ? mapSignature(row) : null;
}

export async function createSignature(
	db: D1Database,
	userId: string,
	input: { name?: string; body?: string } = {}
): Promise<SavedSignature[]> {
	const signatures = await listSignatures(db, userId);
	if (signatures.length >= MAX_SAVED_SIGNATURES) {
		throw new Error(`You can save up to ${MAX_SAVED_SIGNATURES} signatures`);
	}

	const name = nextUnusedName(
		signatures.map((signature) => signature.name),
		parseSignatureName(input.name ?? 'Signature')
	);
	const body = parseAccountSignature(input.body ?? '');
	const isDefault = signatures.length === 0;
	const position =
		signatures.reduce((max, signature) => Math.max(max, signature.position), -1) + 1;

	await db
		.prepare(
			`INSERT INTO signatures (id, user_id, name, body, is_default, position)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), userId, name, body, isDefault ? 1 : 0, position)
		.run();

	const next = await loadSignatureRows(db, userId);
	await syncAccountColumn(db, userId, next);
	return next;
}

export async function updateSignature(
	db: D1Database,
	userId: string,
	signatureId: string,
	patch: { name?: string; body?: string; isDefault?: boolean }
): Promise<SavedSignature[]> {
	const current = await getSignatureForUser(db, userId, signatureId);
	if (!current) {
		throw new Error('Signature not found');
	}

	const name = patch.name !== undefined ? parseSignatureName(patch.name) : current.name;
	const body = patch.body !== undefined ? parseAccountSignature(patch.body) : current.body;
	const makeDefault = patch.isDefault === true || current.is_default;

	const statements = [];
	if (makeDefault && !current.is_default) {
		statements.push(
			db.prepare('UPDATE signatures SET is_default = 0 WHERE user_id = ?').bind(userId)
		);
	}
	statements.push(
		db
			.prepare(
				`UPDATE signatures SET name = ?, body = ?, is_default = ?
				 WHERE id = ? AND user_id = ?`
			)
			.bind(name, body, makeDefault ? 1 : 0, signatureId, userId)
	);
	await db.batch(statements);

	const next = await loadSignatureRows(db, userId);
	await syncAccountColumn(db, userId, next);
	return next;
}

export async function deleteSignature(
	db: D1Database,
	userId: string,
	signatureId: string
): Promise<SavedSignature[]> {
	const current = await getSignatureForUser(db, userId, signatureId);
	if (!current) {
		throw new Error('Signature not found');
	}

	const statements = [
		db
			.prepare('UPDATE addresses SET signature_id = NULL WHERE user_id = ? AND signature_id = ?')
			.bind(userId, signatureId),
		db.prepare('DELETE FROM signatures WHERE id = ? AND user_id = ?').bind(signatureId, userId)
	];

	if (current.is_default) {
		const remaining = (await loadSignatureRows(db, userId)).filter(
			(signature) => signature.id !== signatureId
		);
		if (remaining[0]) {
			statements.push(
				db
					.prepare('UPDATE signatures SET is_default = 1 WHERE id = ? AND user_id = ?')
					.bind(remaining[0].id, userId)
			);
		}
	}

	await db.batch(statements);
	const next = await loadSignatureRows(db, userId);
	await syncAccountColumn(db, userId, next);
	return next;
}

/** Keep the legacy settings endpoint working by writing the default library entry. */
export async function updateEmailSignature(
	db: D1Database,
	userId: string,
	value: string
): Promise<string> {
	const body = parseAccountSignature(value);
	const signatures = await listSignatures(db, userId);
	if (signatures.length === 0) {
		if (!body) {
			await syncAccountColumn(db, userId, []);
			return '';
		}
		const created = await createSignature(db, userId, { name: 'Signature', body });
		return created.find((signature) => signature.is_default)?.body ?? body;
	}

	const target = signatures.find((signature) => signature.is_default) ?? signatures[0];
	const next = await updateSignature(db, userId, target.id, { body });
	return next.find((signature) => signature.is_default)?.body ?? body;
}

export async function resolveOutboundSignature(
	db: D1Database,
	userId: string,
	from: MailAddress,
	input: { signatureId?: string | null; includeSignature?: boolean; isReply: boolean }
): Promise<string> {
	const signatures = await listSignatures(db, userId);
	if (input.signatureId !== undefined) {
		return resolveSignatureBody({
			signatures,
			selectedId: input.signatureId,
			mailboxSignatureId: from.signature_id,
			mailboxBody: from.signature
		});
	}

	const include = input.includeSignature ?? !input.isReply;
	if (!include) return '';

	return resolveSignatureBody({
		signatures,
		mailboxSignatureId: from.signature_id,
		mailboxBody: from.signature
	});
}
