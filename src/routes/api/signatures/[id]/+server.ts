import { json, type RequestHandler } from '@sveltejs/kit';
import { MAX_EMAIL_SIGNATURE_LENGTH, MAX_SIGNATURE_NAME_LENGTH } from '$lib/email-signature';
import { deleteSignature, updateSignature } from '$lib/server/email-signature';

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { name?: unknown; body?: unknown; isDefault?: unknown };
	try {
		body = (await request.json()) as { name?: unknown; body?: unknown; isDefault?: unknown };
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	if (body.name !== undefined && typeof body.name !== 'string') {
		return json({ error: 'Name must be text' }, { status: 400 });
	}
	if (body.body !== undefined && typeof body.body !== 'string') {
		return json({ error: 'Signature must be text' }, { status: 400 });
	}
	if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
		return json({ error: 'isDefault must be a boolean' }, { status: 400 });
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
		const signatures = await updateSignature(db, locals.user.id, params.id!, {
			name: typeof body.name === 'string' ? body.name : undefined,
			body: typeof body.body === 'string' ? body.body : undefined,
			isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined
		});
		return json({ ok: true, signatures });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not save signature';
		const status = message === 'Signature not found' ? 404 : 400;
		return json({ error: message }, { status });
	}
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const signatures = await deleteSignature(db, locals.user.id, params.id!);
		return json({ ok: true, signatures });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not delete signature';
		const status = message === 'Signature not found' ? 404 : 400;
		return json({ error: message }, { status });
	}
};
