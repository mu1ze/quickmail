import { json, type RequestHandler } from '@sveltejs/kit';
import { MAX_EMAIL_SIGNATURE_LENGTH, MAX_SIGNATURE_NAME_LENGTH } from '$lib/email-signature';
import { createSignature, listSignatures } from '$lib/server/email-signature';

export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	return json({ signatures: await listSignatures(db, locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { name?: unknown; body?: unknown } = {};
	try {
		body = (await request.json()) as { name?: unknown; body?: unknown };
	} catch {
		body = {};
	}

	if (body.name !== undefined && typeof body.name !== 'string') {
		return json({ error: 'Name must be text' }, { status: 400 });
	}
	if (body.body !== undefined && typeof body.body !== 'string') {
		return json({ error: 'Signature must be text' }, { status: 400 });
	}
	if (typeof body.name === 'string' && body.name.length > MAX_SIGNATURE_NAME_LENGTH) {
		return json(
			{ error: `Name must be ${MAX_SIGNATURE_NAME_LENGTH} characters or fewer` },
			{ status: 400 }
		);
	}
	if (typeof body.body === 'string' && body.body.length > MAX_EMAIL_SIGNATURE_LENGTH) {
		return json(
			{ error: `Signature must be ${MAX_EMAIL_SIGNATURE_LENGTH} characters or fewer` },
			{ status: 400 }
		);
	}

	try {
		const signatures = await createSignature(db, locals.user.id, {
			name: typeof body.name === 'string' ? body.name : undefined,
			body: typeof body.body === 'string' ? body.body : undefined
		});
		return json({ ok: true, signatures });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not create signature' },
			{ status: 400 }
		);
	}
};
