import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { EMBEDDED_MIGRATIONS } from './embedded-migrations';
import {
	applySchema,
	pendingMigrations,
	resetSchemaCache,
	shouldBackfillExistingSchema,
	splitSqlStatements
} from './schema';

const migrationsDir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../migrations');

describe('embedded migrations', () => {
	test('stay in sync with the migrations folder', () => {
		const onDisk = readdirSync(migrationsDir)
			.filter((name) => /^\d+_.*\.sql$/.test(name))
			.sort();
		assert.deepEqual(
			EMBEDDED_MIGRATIONS.map((migration) => migration.name),
			onDisk
		);
		for (const migration of EMBEDDED_MIGRATIONS) {
			assert.equal(migration.sql, readFileSync(join(migrationsDir, migration.name), 'utf8'));
		}
	});
});

describe('splitSqlStatements', () => {
	test('keeps a multi-line CREATE TABLE as one statement', () => {
		const statements = splitSqlStatements(`CREATE TABLE users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL
);
CREATE INDEX idx_users_email ON users(email);`);
		assert.deepEqual(statements, [
			'CREATE TABLE users (\n\tid TEXT PRIMARY KEY,\n\temail TEXT NOT NULL\n)',
			'CREATE INDEX idx_users_email ON users(email)'
		]);
	});

	test('drops -- comments without eating the next statement', () => {
		const statements = splitSqlStatements(`-- domains the operator connected
CREATE TABLE domains (id TEXT PRIMARY KEY);`);
		assert.deepEqual(statements, ['CREATE TABLE domains (id TEXT PRIMARY KEY)']);
	});

	test('splits every statement in the bundled migrations', () => {
		const total = EMBEDDED_MIGRATIONS.flatMap((migration) => splitSqlStatements(migration.sql));
		assert.ok(total.length > EMBEDDED_MIGRATIONS.length);
		assert.ok(total.some((sql) => sql.startsWith('CREATE TABLE users')));
		assert.ok(total.every((sql) => !sql.startsWith('--')));
	});
});

describe('pendingMigrations', () => {
	test('returns every file when nothing has been applied', () => {
		assert.deepEqual(
			pendingMigrations([]).map((migration) => migration.name),
			EMBEDDED_MIGRATIONS.map((migration) => migration.name)
		);
	});

	test('skips files already recorded in d1_migrations', () => {
		const remaining = pendingMigrations(['0001_init.sql', '0002_attachments.sql']);
		assert.equal(remaining[0]?.name, '0003_reply_thread.sql');
		assert.equal(remaining.length, EMBEDDED_MIGRATIONS.length - 2);
	});
});

describe('shouldBackfillExistingSchema', () => {
	test('records current files when tables exist without bookkeeping', () => {
		assert.equal(shouldBackfillExistingSchema(true, 0), true);
		assert.equal(shouldBackfillExistingSchema(true, 3), false);
		assert.equal(shouldBackfillExistingSchema(false, 0), false);
	});
});

type MockState = {
	tables: Set<string>;
	applied: string[];
	statements: string[];
};

function mockD1(initial?: { tables?: string[]; applied?: string[] }): D1Database & { state: MockState } {
	const state: MockState = {
		tables: new Set(initial?.tables ?? []),
		applied: [...(initial?.applied ?? [])],
		statements: []
	};

	const db = {
		state,
		async exec(sql: string) {
			state.statements.push(sql);
			return { count: 1, duration: 0 };
		},
		prepare(sql: string): D1PreparedStatement {
			let bound: unknown[] = [];
			state.statements.push(sql);
			if (/CREATE TABLE(?: IF NOT EXISTS)? users\b/.test(sql)) state.tables.add('users');
			if (/CREATE TABLE(?: IF NOT EXISTS)? d1_migrations\b/.test(sql)) state.tables.add('d1_migrations');
			const stmt = {
				bind(...values: unknown[]) {
					bound = values;
					return stmt;
				},
				async first() {
					if (sql.includes('sqlite_master') && sql.includes('name = ?')) {
						return state.tables.has(String(bound[0])) ? { present: 1 } : null;
					}
					return null;
				},
				async all() {
					if (sql.includes('FROM d1_migrations')) {
						return { results: state.applied.map((name) => ({ name })), success: true, meta: {} };
					}
					return { results: [], success: true, meta: {} };
				},
				async run() {
					if (sql.includes('INSERT') && bound[0]) {
						const name = String(bound[0]);
						if (!state.applied.includes(name)) state.applied.push(name);
					}
					return { success: true, meta: { changes: 1 } };
				},
				async raw() {
					return [];
				}
			};
			return stmt as unknown as D1PreparedStatement;
		},
		async batch(statements: D1PreparedStatement[]) {
			for (const statement of statements) {
				await (statement as unknown as { run: () => Promise<unknown> }).run();
			}
			return [];
		},
		async dump() {
			return new ArrayBuffer(0);
		}
	};

	return db as unknown as D1Database & { state: MockState };
}

describe('applySchema', () => {
	test('applies every pending file on an empty database', async () => {
		resetSchemaCache();
		const db = mockD1();
		const result = await applySchema(db);
		assert.equal(result.backfilled, false);
		assert.deepEqual(
			result.applied,
			EMBEDDED_MIGRATIONS.map((migration) => migration.name)
		);
		assert.ok(db.state.statements.some((sql) => /CREATE TABLE users\b/.test(sql)));
		assert.deepEqual(db.state.applied, result.applied);
	});

	test('is a no-op when Wrangler has already applied migrations', async () => {
		resetSchemaCache();
		const names = EMBEDDED_MIGRATIONS.map((migration) => migration.name);
		const db = mockD1({ tables: ['users', 'd1_migrations'], applied: names });
		const result = await applySchema(db);
		assert.deepEqual(result.applied, []);
		assert.equal(result.backfilled, false);
		assert.equal(
			db.state.statements.filter((sql) => /CREATE TABLE users\b/.test(sql)).length,
			0
		);
	});

	test('backfills bookkeeping when the schema already exists', async () => {
		resetSchemaCache();
		const db = mockD1({ tables: ['users'] });
		const result = await applySchema(db);
		assert.equal(result.backfilled, true);
		assert.deepEqual(result.applied, []);
		assert.equal(
			db.state.statements.filter((sql) => /CREATE TABLE users\b/.test(sql)).length,
			0
		);
		assert.deepEqual(
			db.state.applied,
			EMBEDDED_MIGRATIONS.map((migration) => migration.name)
		);
	});
});
