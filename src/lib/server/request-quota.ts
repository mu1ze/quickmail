import type { D1Database } from '@cloudflare/workers-types';
/** Atomic reservation before uploads or provider sends; UTC hourly buckets. */
export async function reserveRequestQuota(
	db: D1Database,
	userId: string,
	kind: 'mail' | 'draft' | 'mutation' | 'upload',
	now = Date.now()
): Promise<boolean> {
	const window = Math.floor(now / 3600000);
	const result = await db
		.prepare(
			`INSERT INTO request_quotas(user_id,kind,window,attempts) VALUES(?,?,?,1)
		ON CONFLICT(user_id,kind) DO UPDATE SET window=excluded.window,
		attempts=CASE WHEN request_quotas.window<>excluded.window THEN 1 ELSE attempts+1 END
		WHERE request_quotas.window<>excluded.window OR attempts<?`
		)
		.bind(
			userId,
			kind,
			window,
			kind === 'draft' || kind === 'mutation' ? 1800 : kind === 'mail' ? 300 : 100
		)
		.run();
	return (result.meta.changes ?? 0) > 0;
}
