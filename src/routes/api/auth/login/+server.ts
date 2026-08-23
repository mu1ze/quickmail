import { json, type RequestHandler } from '@sveltejs/kit';
import { login, logout, readSessionToken, sessionCookieOptions, SESSION_COOKIE } from '$lib/server/auth';
import { SESSION_DAYS } from '$lib/server/constants';
import {
	checkLoginRateLimit,
	clearSuccessfulLogin,
	recordFailedLogin
} from '$lib/server/login-rate-limit';

export const POST: RequestHandler = async ({ request, cookies, platform, getClientAddress }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = (await request.json().catch(() => null)) as {
		email?: unknown;
		password?: unknown;
	} | null;
	if (typeof body?.email !== 'string' || typeof body.password !== 'string') {
		return json({ error: 'Email and password are required' }, { status: 400 });
	}
	const email = body.email.trim().toLowerCase();
	const ip = getClientAddress();
	const rate = await checkLoginRateLimit(db, { email, ip });
	if (rate.limited) {
		return json(
			{ error: 'Too many sign-in attempts. Try again later.' },
			{ status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
		);
	}

	const result = await login(db, email, body.password);
	if (!result) {
		await recordFailedLogin(db, { email, ip });
		return json({ error: 'Invalid email or password' }, { status: 401 });
	}
	await clearSuccessfulLogin(db, email);

	cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(SESSION_DAYS * 24 * 60 * 60));

	return json({ user: result.user });
};

export const DELETE: RequestHandler = async ({ cookies, platform }) => {
	const db = platform?.env.DB;
	const token = readSessionToken(cookies);

	if (db && token) {
		await logout(db, token);
	}

	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
