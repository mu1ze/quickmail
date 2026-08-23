import type { D1Database } from '@cloudflare/workers-types';
import { hashToken } from './crypto';

export const LOGIN_RATE_WINDOW_SECONDS = 15 * 60;
export const LOGIN_ACCOUNT_ATTEMPTS = 10;
export const LOGIN_IP_ATTEMPTS = 30;

type LimitRow = { attempts: number; window_started_at: number };

async function keyHash(kind: 'account' | 'ip', value: string): Promise<string> {
	return hashToken(`login:${kind}:${value.trim().toLowerCase()}`);
}

async function isKeyLimited(
	db: D1Database,
	key: string,
	limit: number,
	now: number
): Promise<boolean> {
	const row = await db
		.prepare('SELECT attempts, window_started_at FROM login_rate_limits WHERE key_hash = ?')
		.bind(key)
		.first<LimitRow>();
	return Boolean(
		row && now - row.window_started_at < LOGIN_RATE_WINDOW_SECONDS && row.attempts >= limit
	);
}

export async function checkLoginRateLimit(
	db: D1Database,
	input: { email: string; ip: string }
): Promise<{ limited: boolean; retryAfter: number }> {
	const now = Math.floor(Date.now() / 1000);
	const [accountKey, ipKey] = await Promise.all([
		keyHash('account', input.email),
		keyHash('ip', input.ip)
	]);
	const [accountLimited, ipLimited] = await Promise.all([
		isKeyLimited(db, accountKey, LOGIN_ACCOUNT_ATTEMPTS, now),
		isKeyLimited(db, ipKey, LOGIN_IP_ATTEMPTS, now)
	]);
	return { limited: accountLimited || ipLimited, retryAfter: LOGIN_RATE_WINDOW_SECONDS };
}

export async function recordFailedLogin(
	db: D1Database,
	input: { email: string; ip: string }
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	const [accountKey, ipKey] = await Promise.all([
		keyHash('account', input.email),
		keyHash('ip', input.ip)
	]);
	await db.batch([
		db
			.prepare(
				`INSERT INTO login_rate_limits (key_hash, attempts, window_started_at, updated_at)
				 VALUES (?, 1, ?, ?)
				 ON CONFLICT(key_hash) DO UPDATE SET
				   attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
				   window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END,
				   updated_at = excluded.updated_at`
			)
			.bind(accountKey, now, now, now - LOGIN_RATE_WINDOW_SECONDS, now - LOGIN_RATE_WINDOW_SECONDS),
		db
			.prepare(
				`INSERT INTO login_rate_limits (key_hash, attempts, window_started_at, updated_at)
				 VALUES (?, 1, ?, ?)
				 ON CONFLICT(key_hash) DO UPDATE SET
				   attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
				   window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END,
				   updated_at = excluded.updated_at`
			)
			.bind(ipKey, now, now, now - LOGIN_RATE_WINDOW_SECONDS, now - LOGIN_RATE_WINDOW_SECONDS)
	]);

	// Opportunistic cleanup keeps this abuse-control table bounded without a cron.
	await db
		.prepare('DELETE FROM login_rate_limits WHERE updated_at < ?')
		.bind(now - LOGIN_RATE_WINDOW_SECONDS * 4)
		.run();
}

export async function clearSuccessfulLogin(db: D1Database, email: string): Promise<void> {
	await db
		.prepare('DELETE FROM login_rate_limits WHERE key_hash = ?')
		.bind(await keyHash('account', email))
		.run();
}
