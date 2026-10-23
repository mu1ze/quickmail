import type { Cookies } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import type { User } from '$lib/types';
import {
	getUserFromSession,
	logout,
	readSessionToken,
	SESSION_COOKIE,
	sessionCookieOptions
} from './auth';
import { hashToken } from './crypto';
import { DOMAIN_COOKIE, SESSION_DAYS } from './constants';

export const ACCOUNTS_COOKIE = 'mail_accounts';
export const MAX_BROWSER_ACCOUNTS = 8;
type CookieJar = Pick<Cookies, 'get' | 'set' | 'delete'>;
type BrowserSession = { user: User; token: string };
const MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

/** Tokens stay in HttpOnly cookies and are validated against D1 on every use. */
export function readBrowserTokens(cookies: Pick<Cookies, 'get'>): string[] {
	let saved: unknown = [];
	try {
		saved = JSON.parse(cookies.get(ACCOUNTS_COOKIE) ?? '[]');
	} catch {
		/* invalid cookie */
	}
	const active = readSessionToken(cookies);
	return [
		...new Set([active, ...(Array.isArray(saved) ? saved.slice(0, MAX_BROWSER_ACCOUNTS) : [])])
	]
		.filter(
			(token): token is string => typeof token === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(token)
		)
		.slice(0, MAX_BROWSER_ACCOUNTS + 1);
}

export async function browserSessions(
	db: D1Database,
	cookies: Pick<Cookies, 'get'>
): Promise<BrowserSession[]> {
	const tokens = readBrowserTokens(cookies);
	if (!tokens.length) return [];
	const hashes = await Promise.all(tokens.map(hashToken));
	const { results } = await db
		.prepare(
			`SELECT s.token_hash,u.id,u.email,u.name,u.is_admin,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash IN (${hashes.map(() => '?').join(',')}) AND datetime(s.expires_at)>datetime('now')`
		)
		.bind(...hashes)
		.all<{
			token_hash: string;
			id: string;
			email: string;
			name: string;
			is_admin: number;
			created_at: string;
		}>();
	const sessions = tokens.map((token, i) => {
		const row = results.find((r) => r.token_hash === hashes[i]);
		return {
			token,
			user: row
				? {
						id: row.id,
						email: row.email,
						name: row.name,
						is_admin: row.is_admin === 1,
						created_at: row.created_at
					}
				: null
		};
	});
	const users = new Set<string>();
	return sessions.filter((session): session is BrowserSession => {
		if (!session.user || users.has(session.user.id)) return false;
		users.add(session.user.id);
		return true;
	});
}

function writeSessions(cookies: CookieJar, sessions: BrowserSession[], active?: BrowserSession) {
	if (sessions.length)
		cookies.set(
			ACCOUNTS_COOKIE,
			JSON.stringify(sessions.map((s) => s.token)),
			sessionCookieOptions(MAX_AGE)
		);
	else cookies.delete(ACCOUNTS_COOKIE, { path: '/' });
	if (active) cookies.set(SESSION_COOKIE, active.token, sessionCookieOptions(MAX_AGE));
	else cookies.delete(SESSION_COOKIE, { path: '/' });
	cookies.delete(DOMAIN_COOKIE, { path: '/' });
}

/** Preserve other identities when signing in, including legacy single-session logins. */
export async function rememberBrowserAccount(
	db: D1Database,
	cookies: CookieJar,
	session: BrowserSession
): Promise<boolean> {
	const previous = await browserSessions(db, cookies);
	const others = previous.filter((s) => s.user.id !== session.user.id);
	if (others.length >= MAX_BROWSER_ACCOUNTS) {
		await logout(db, session.token);
		return false;
	}
	for (const old of previous.filter(
		(s) => s.user.id === session.user.id && s.token !== session.token
	)) {
		await logout(db, old.token);
	}
	writeSessions(cookies, [session, ...others], session);
	return true;
}

export async function switchBrowserAccount(
	db: D1Database,
	cookies: CookieJar,
	userId: string
): Promise<User | null> {
	const sessions = await browserSessions(db, cookies);
	const target = sessions.find((s) => s.user.id === userId);
	if (!target) return null;
	writeSessions(cookies, [target, ...sessions.filter((s) => s !== target)], target);
	return target.user;
}

/** Sign out here only; never revoke the other accounts or another device's sessions. */
export async function signOutBrowserAccount(
	db: D1Database,
	cookies: CookieJar,
	all = false
): Promise<User | null> {
	const active = readSessionToken(cookies);
	const tokens = all ? readBrowserTokens(cookies) : active ? [active] : [];
	for (const token of tokens) await logout(db, token);
	const remaining = all ? [] : await browserSessions(db, cookies);
	writeSessions(cookies, remaining, remaining[0]);
	return remaining[0]?.user ?? null;
}
