/// <reference path="../../../../node_modules/bun-types/sqlite.d.ts" />
/**
 * An in-memory D1 stand-in for tests: bun:sqlite with every migration applied, plus a
 * Map-backed R2 bucket. Only the calls the app makes are implemented.
 */
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export function createTestDb(): { sqlite: Database; db: D1Database } {
	const sqlite = new Database(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
		sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	const db = {
		async batch(statements: { run: () => Promise<unknown> }[]) {
			sqlite.exec('BEGIN');
			try {
				const results = [];
				for (const statement of statements) results.push(await statement.run());
				sqlite.exec('COMMIT');
				return results;
			} catch (cause) {
				sqlite.exec('ROLLBACK');
				throw cause;
			}
		},
		prepare(sql: string) {
			let values: unknown[] = [];
			return {
				bind(...args: unknown[]) {
					values = args.map((value) => (value === undefined ? null : value));
					return this;
				},
				async all() {
					return { results: sqlite.query(sql).all(...(values as never[])) };
				},
				async first() {
					return sqlite.query(sql).get(...(values as never[])) ?? null;
				},
				async run() {
					return { meta: { changes: sqlite.query(sql).run(...(values as never[])).changes } };
				}
			};
		}
	} as unknown as D1Database;
	return { sqlite, db };
}

export function createTestBucket(): R2Bucket {
	const objects = new Map<string, Uint8Array>();
	return {
		async put(key: string, value: Uint8Array | ArrayBuffer) {
			objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
			return {};
		},
		async get(key: string) {
			const bytes = objects.get(key);
			return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null;
		},
		async delete(key: string) {
			objects.delete(key);
		}
	} as unknown as R2Bucket;
}
