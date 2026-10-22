import { json, type RequestHandler } from '@sveltejs/kit';
import { login } from '$lib/server/auth';
import { MAX_BROWSER_ACCOUNTS, rememberBrowserAccount, signOutBrowserAccount } from '$lib/server/browser-accounts';
import {
	checkLoginRateLimit,
	clearSuccessfulLogin,
	recordFailedLogin
} from '$lib/server/login-rate-limit';

export const POST: RequestHandler = async ({ request, cookies, platform, getClientAddress, url }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) {
		return json({ error: 'Cross-origin request rejected' }, { status: 403 });
	}

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

	if (!(await rememberBrowserAccount(db, cookies, result))) {
		return json({ error: `You can keep ${MAX_BROWSER_ACCOUNTS} accounts signed in. Sign out of one before adding another.` }, { status: 409 });
	}

	return json({ user: result.user });
};

export const DELETE: RequestHandler = async ({ cookies, platform, request, url, locals }) => {
	const db = platform?.env.DB;
	if (!db || locals.authMethod === 'api_token') return json({ error: 'Unauthorized' }, { status: 401 });
	if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) {
		return json({ error: 'Cross-origin request rejected' }, { status: 403 });
	}
	const user = await signOutBrowserAccount(db, cookies, url.searchParams.get('all') === '1');
	return json({ ok: true, user });
};
