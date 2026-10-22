import { json, type RequestHandler } from '@sveltejs/kit';
import { MIN_PASSWORD_LENGTH, recoverUserPassword, SESSION_COOKIE, sessionCookieOptions } from '$lib/server/auth';
import { SESSION_DAYS } from '$lib/server/constants';
import { checkLoginRateLimit, recordFailedLogin } from '$lib/server/login-rate-limit';

export const POST: RequestHandler = async ({ request, cookies, platform, getClientAddress }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const expectedKey = platform.env.PASSWORD_RESET_KEY?.trim() ?? '';
	if (!expectedKey) {
		return json(
			{
				error:
					'Password recovery is not enabled. Run `bunx wrangler secret put PASSWORD_RESET_KEY`, then try again. No database migration is required.'
			},
			{ status: 403 }
		);
	}

	const body = (await request.json().catch(() => null)) as {
		email?: unknown;
		password?: unknown;
		recoveryKey?: unknown;
	} | null;

	if (
		typeof body?.email !== 'string' ||
		typeof body.password !== 'string' ||
		typeof body.recoveryKey !== 'string'
	) {
		return json({ error: 'Email, new password, and recovery key are required' }, { status: 400 });
	}

	const email = body.email.trim().toLowerCase();
	const ip = getClientAddress();
	const rate = await checkLoginRateLimit(db, { email, ip });
	if (rate.limited) {
		return json(
			{ error: 'Too many attempts. Try again later.' },
			{ status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
		);
	}

	if (body.password.length < MIN_PASSWORD_LENGTH) {
		return json(
			{ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
			{ status: 400 }
		);
	}

	try {
		const result = await recoverUserPassword(db, {
			email,
			password: body.password,
			recoveryKey: body.recoveryKey,
			expectedKey
		});
		cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(SESSION_DAYS * 24 * 60 * 60));
		return json({ user: result.user });
	} catch (error) {
		await recordFailedLogin(db, { email, ip });
		return json(
			{ error: error instanceof Error ? error.message : 'Could not update password' },
			{ status: 400 }
		);
	}
};
