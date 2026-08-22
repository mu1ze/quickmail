import type { D1Database } from '@cloudflare/workers-types';
import { EMBEDDED_MIGRATIONS, type EmbeddedMigration } from './embedded-migrations';

/**
 * Same bookkeeping table Wrangler uses for `d1 migrations apply`, so CLI and
 * Worker-applied schema stay in sync.
 *
 * D1 `exec()` treats newlines as statement separators, so this must be one line.
 */
export const D1_MIGRATIONS_TABLE =
	'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)';

/** Split a migration file into statements D1 can run with `prepare().run()`. */
export function splitSqlStatements(sql: string): string[] {
	const stripped = sql
		.split('\n')
		.map(stripLineComment)
		.join('\n');

	const statements: string[] = [];
	let current = '';
	let inSingle = false;

	for (let i = 0; i < stripped.length; i++) {
		const char = stripped[i];
		if (char === "'" && inSingle) {
			current += char;
			if (stripped[i + 1] === "'") {
				current += stripped[++i];
				continue;
			}
			inSingle = false;
			continue;
		}
		if (char === "'" && !inSingle) {
			inSingle = true;
			current += char;
			continue;
		}
		if (char === ';' && !inSingle) {
			const statement = current.trim();
			if (statement) statements.push(statement);
			current = '';
			continue;
		}
		current += char;
	}

	const trailing = current.trim();
	if (trailing) statements.push(trailing);
	return statements;
}

function stripLineComment(line: string): string {
	let inSingle = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === "'" && inSingle) {
			if (line[i + 1] === "'") {
				i++;
				continue;
			}
			inSingle = false;
			continue;
		}
		if (char === "'" && !inSingle) {
			inSingle = true;
			continue;
		}
		if (!inSingle && char === '-' && line[i + 1] === '-') {
			return line.slice(0, i);
		}
	}
	return line;
}

export function pendingMigrations(
	appliedNames: Iterable<string>,
	all: readonly EmbeddedMigration[] = EMBEDDED_MIGRATIONS
): EmbeddedMigration[] {
	const applied = new Set(appliedNames);
	return all.filter((migration) => !applied.has(migration.name));
}

export function shouldBackfillExistingSchema(
	usersTableExists: boolean,
	appliedCount: number
): boolean {
	return usersTableExists && appliedCount === 0;
}

async function tableExists(db: D1Database, name: string): Promise<boolean> {
	const row = await db
		.prepare(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`)
		.bind(name)
		.first<{ present: number }>();
	return row?.present === 1;
}

async function listAppliedMigrations(db: D1Database): Promise<string[]> {
	const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
	return results.map((row) => row.name);
}

async function recordApplied(db: D1Database, names: readonly string[]): Promise<void> {
	if (names.length === 0) return;
	await db.batch(
		names.map((name) => db.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(name))
	);
}

async function runSql(db: D1Database, sql: string): Promise<void> {
	for (const statement of splitSqlStatements(sql)) {
		await db.prepare(statement).run();
	}
}

/**
 * Apply any migration files that have not been recorded in `d1_migrations`.
 * Safe to call on every request: a fully migrated database is a couple of
 * cheap SELECTs.
 */
export async function applySchema(db: D1Database): Promise<{ applied: string[]; backfilled: boolean }> {
	await db.prepare(D1_MIGRATIONS_TABLE).run();

	const appliedNames = await listAppliedMigrations(db);
	if (shouldBackfillExistingSchema(await tableExists(db, 'users'), appliedNames.length)) {
		await recordApplied(
			db,
			EMBEDDED_MIGRATIONS.map((migration) => migration.name)
		);
		return { applied: [], backfilled: true };
	}

	const pending = pendingMigrations(appliedNames);
	for (const migration of pending) {
		await runSql(db, migration.sql);
		await recordApplied(db, [migration.name]);
	}

	return { applied: pending.map((migration) => migration.name), backfilled: false };
}

let ensuring: Promise<void> | null = null;

/** Ensure the mailbox schema exists. Cached per isolate after the first success. */
export function ensureSchema(db: D1Database): Promise<void> {
	if (!ensuring) {
		ensuring = applySchema(db)
			.then(() => undefined)
			.catch((error: unknown) => {
				ensuring = null;
				throw error;
			});
	}
	return ensuring;
}

/** Test-only: drop the isolate cache so a new database can be applied. */
export function resetSchemaCache(): void {
	ensuring = null;
}
