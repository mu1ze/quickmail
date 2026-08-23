#!/usr/bin/env node
/**
 * Reset user password(s) in remote (or local) D1.
 * Usage:
 *   bun scripts/reset-admin-password.mjs <email> <password> [--local]
 *   bun scripts/reset-admin-password.mjs --all <password> [--local]
 */
import { execSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { subtle } = webcrypto;
const PBKDF2_ITERATIONS = 600_000;

// Read the D1 name out of wrangler.jsonc so this keeps working if you rename it.
const wranglerPath = new URL('../wrangler.jsonc', import.meta.url);
const databaseName = readFileSync(wranglerPath, 'utf8').match(
	/"database_name"\s*:\s*"([^"]+)"/
)?.[1];

if (!databaseName) {
	console.error('Could not find "database_name" in wrangler.jsonc.');
	process.exit(1);
}

function toBase64(bytes) {
	return Buffer.from(bytes).toString('base64');
}

async function hashPassword(password) {
	const salt = webcrypto.getRandomValues(new Uint8Array(16));
	const keyMaterial = await subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const hash = new Uint8Array(
		await subtle.deriveBits(
			{ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
			keyMaterial,
			256
		)
	);
	return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

const resetAll = process.argv.includes('--all');
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const email = resetAll ? undefined : positional[0];
const password = resetAll ? positional[0] : positional[1];
const local = process.argv.includes('--local');

function usage(message) {
	console.error(message);
	console.error('\nUsage:');
	console.error('  bun scripts/reset-admin-password.mjs <email> <password> [--local]');
	console.error('  bun scripts/reset-admin-password.mjs --all <password> [--local]');
	process.exit(1);
}

if (!resetAll && !email?.includes('@')) usage('A valid login email is required.');
if (!password || password.length < 12) usage('Password must be at least 12 characters.');

const passwordHash = await hashPassword(password);
const escape = (value) => value.replace(/'/g, "''");
const sql = resetAll
	? `UPDATE users SET password_hash = '${escape(passwordHash)}'; DELETE FROM sessions; DELETE FROM api_tokens; DELETE FROM login_rate_limits;`
	: `UPDATE users SET password_hash = '${escape(passwordHash)}' WHERE email = '${escape(
			email.toLowerCase()
		)}';`;

execSync(
	`bunx wrangler d1 execute ${databaseName} ${local ? '--local' : '--remote'} --command "${sql.replace(/"/g, '\\"')}"`,
	{ stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname }
);

console.log(
	resetAll
		? `\nPassword reset for every account (${local ? 'local' : 'remote'} DB).`
		: `\nPassword reset for ${email} (${local ? 'local' : 'remote'} DB).`
);
