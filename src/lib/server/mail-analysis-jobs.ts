import type { D1Database, MessageBatch, Queue } from '@cloudflare/workers-types';
import { ANALYSIS_VERSION, SUBQ_MODEL, analysisSignals } from '$lib/mail-analysis';
import { buildAnalysisState, requestSubq, SubqError, type AnalysisMetadata } from './subq';

export type AnalysisQueueMessage = { emailId: string; userId: string; version: string };
export type AnalysisEnv = {
	DB: D1Database; SUBQ_API_KEY?: string;
	MAIL_ANALYSIS_QUEUE?: Queue<AnalysisQueueMessage>;
	fetch?: typeof fetch;
};
type Job = { email_id: string; user_id: string; attempts: number };
const now = () => Math.floor(Date.now() / 1000);
const MAX_ATTEMPTS = 5;

/** Delivery is already persisted; failed queue sends are repaired by cron. */
export async function dispatchAnalysis(env: AnalysisEnv, userId: string, emailId?: string): Promise<void> {
	if (!env.SUBQ_API_KEY) return;
	const pause = await env.DB.prepare('SELECT pause_until FROM mail_analysis_provider_state WHERE id=1').first<{ pause_until: number }>();
	if (pause && pause.pause_until > now()) return;
	const { results } = await env.DB.prepare(`SELECT j.email_id,j.user_id,j.attempts FROM email_analysis_jobs j
		JOIN mail_analysis_settings s ON s.user_id=j.user_id AND s.enabled=1
		JOIN emails e ON e.id=j.email_id AND e.user_id=j.user_id AND e.deleted_at IS NULL
		WHERE j.user_id=? AND j.version=? AND j.status='pending' AND j.next_attempt_at<=? AND j.queued_until<=?
		${emailId ? 'AND j.email_id=?' : ''} ORDER BY j.next_attempt_at,j.email_id LIMIT 20`)
		.bind(userId, ANALYSIS_VERSION, now(), now(), ...(emailId ? [emailId] : [])).all<Job>();
	for (const job of results) {
		if (env.MAIL_ANALYSIS_QUEUE) {
			try {
				await env.MAIL_ANALYSIS_QUEUE.send({ emailId: job.email_id, userId: job.user_id, version: ANALYSIS_VERSION });
				// Bound duplicate dispatches while preserving recovery if delivery is lost.
				await env.DB.prepare("UPDATE email_analysis_jobs SET queued_until=? WHERE email_id=? AND user_id=? AND version=? AND status='pending'").bind(now()+60,job.email_id,job.user_id,ANALYSIS_VERSION).run();
			} catch { /* durable job remains pending */ }
		} else {
			// Local development and small self-hosted installs work without a Queue.
			await processAnalysisJob(env, { emailId: job.email_id, userId: job.user_id, version: ANALYSIS_VERSION });
		}
	}
}

export async function processAnalysisJob(env: AnalysisEnv, message: AnalysisQueueMessage): Promise<void> {
	if (!message || typeof message.emailId !== 'string' || typeof message.userId !== 'string' || !env.SUBQ_API_KEY || message.version !== ANALYSIS_VERSION) return;
	const db = env.DB, token = crypto.randomUUID();
	const pause = await db.prepare('SELECT pause_until FROM mail_analysis_provider_state WHERE id=1').first<{ pause_until: number }>();
	if (pause && pause.pause_until > now()) return;
	const claimed = await db.prepare(`UPDATE email_analysis_jobs SET status='processing',lease_until=?,lease_token=?,attempts=attempts+1
		WHERE email_id=? AND user_id=? AND version=? AND attempts<?
		AND next_attempt_at<=? AND (status='pending' OR (status='processing' AND lease_until<=?))
		AND EXISTS(SELECT 1 FROM mail_analysis_settings WHERE user_id=? AND enabled=1)
		AND EXISTS(SELECT 1 FROM emails WHERE id=? AND user_id=? AND direction='inbound' AND deleted_at IS NULL)`)
		.bind(now()+120,token,message.emailId,message.userId,ANALYSIS_VERSION,MAX_ATTEMPTS,now(),now(),message.userId,message.emailId,message.userId).run();
	if (!claimed.meta.changes) return;
	try {
		const row = await db.prepare(`SELECT e.from_addr,e.from_name,e.to_addr,e.cc_addr,e.subject,e.body_text,e.body_html,m.metadata_json
			FROM emails e LEFT JOIN email_analysis_metadata m ON m.email_id=e.id AND m.user_id=e.user_id
			WHERE e.id=? AND e.user_id=? AND e.deleted_at IS NULL`).bind(message.emailId,message.userId).first<{
			from_addr: string; from_name: string|null; to_addr: string; cc_addr: string|null; subject: string; body_text: string|null; body_html: string|null; metadata_json: string|null;
		}>();
		if (!row) return;
		let metadata: AnalysisMetadata = {};
		try { metadata = JSON.parse(row.metadata_json ?? '{}'); } catch { /* missing legacy metadata */ }
		const files = await db.prepare('SELECT filename,content_type FROM email_attachments WHERE email_id=? LIMIT 20').bind(message.emailId).all<{ filename: string; content_type: string }>();
		metadata.attachments = files.results.map(a => ({ filename: a.filename, type: a.content_type }));
		const state = buildAnalysisState({ from: row.from_addr, fromName: row.from_name, to: row.to_addr, cc: row.cc_addr, subject: row.subject, bodyText: row.body_text, bodyHtml: row.body_html, metadata });
		const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state))))].map(b=>b.toString(16).padStart(2,'0')).join('');
		// Check consent immediately before the external call, including during a lease.
		const consent = await db.prepare(`SELECT 1 FROM email_analysis_jobs j JOIN mail_analysis_settings s ON s.user_id=j.user_id AND s.enabled=1
			WHERE j.email_id=? AND j.user_id=? AND j.version=? AND j.lease_token=?`).bind(message.emailId,message.userId,ANALYSIS_VERSION,token).first();
		if (!consent) return;
		const result = await requestSubq(env.SUBQ_API_KEY, state, env.fetch);
		const signals = analysisSignals(result.answers);
		const guard = `EXISTS(SELECT 1 FROM email_analysis_jobs j JOIN mail_analysis_settings s ON s.user_id=j.user_id AND s.enabled=1
			JOIN emails e ON e.id=j.email_id AND e.user_id=j.user_id AND e.deleted_at IS NULL
			WHERE j.email_id=? AND j.user_id=? AND j.version=? AND j.lease_token=?)`;
		await db.batch([
			db.prepare(`INSERT INTO email_analysis(email_id,user_id,version,model,input_hash,category,predicted_category,confidence,review,phishing,spam,needs_reply,deadline,urgency,answers_json,input_tokens)
				SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}
				ON CONFLICT(email_id) DO UPDATE SET version=excluded.version,model=excluded.model,input_hash=excluded.input_hash,category=excluded.category,predicted_category=excluded.predicted_category,
				confidence=excluded.confidence,review=excluded.review,phishing=excluded.phishing,spam=excluded.spam,needs_reply=excluded.needs_reply,deadline=excluded.deadline,urgency=excluded.urgency,
				answers_json=excluded.answers_json,input_tokens=excluded.input_tokens,analyzed_at=datetime('now')`)
				.bind(message.emailId,message.userId,ANALYSIS_VERSION,SUBQ_MODEL,hash,signals.category,result.answers.folder.choice,signals.confidence,Number(signals.review),Number(signals.phishing),Number(signals.spam),Number(signals.needsReply),Number(signals.deadline),signals.urgency,JSON.stringify(result.answers),result.inputTokens,message.emailId,message.userId,ANALYSIS_VERSION,token),
			db.prepare("UPDATE email_analysis_jobs SET status='analyzed',lease_until=0,lease_token=NULL,error_code=NULL WHERE email_id=? AND user_id=? AND version=? AND lease_token=?")
				.bind(message.emailId,message.userId,ANALYSIS_VERSION,token)
		]);
	} catch (error) {
		const failure = error instanceof SubqError ? error : new SubqError('analysis_storage_error', true);
		const job = await db.prepare('SELECT attempts FROM email_analysis_jobs WHERE email_id=? AND user_id=? AND version=? AND lease_token=?').bind(message.emailId,message.userId,ANALYSIS_VERSION,token).first<{ attempts: number }>();
		if (!job) return;
		const delay = Math.max(failure.retryAfterSeconds, Math.min(3600, 30 * 2 ** job.attempts)) + Math.floor(Math.random()*10);
		await db.prepare(`UPDATE email_analysis_jobs SET status=?,next_attempt_at=?,queued_until=0,lease_until=0,lease_token=NULL,error_code=?
			WHERE email_id=? AND user_id=? AND version=? AND lease_token=?`)
			.bind(failure.retryable && job.attempts < MAX_ATTEMPTS ? 'pending' : 'failed',now()+delay,failure.code,message.emailId,message.userId,ANALYSIS_VERSION,token).run();
		if (['subq_http_401','subq_http_402','subq_http_403','subq_http_429'].includes(failure.code) || failure.code.startsWith('subq_http_5')) {
			await db.prepare(`INSERT INTO mail_analysis_provider_state(id,pause_until,error_code) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET pause_until=MAX(pause_until,excluded.pause_until),error_code=excluded.error_code`)
				.bind(now() + (failure.retryable ? delay : 3600), failure.code).run();
		}
	}
}

export async function reconcileAnalysisJobs(env: AnalysisEnv): Promise<void> {
	if (!env.SUBQ_API_KEY) return;
	await env.DB.prepare(`UPDATE email_analysis_jobs SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'pending' END,lease_token=NULL,lease_until=0,error_code='analysis_lease_expired'
		WHERE status='processing' AND lease_until<=?`).bind(MAX_ATTEMPTS,now()).run();
	const { results } = await env.DB.prepare(`SELECT DISTINCT j.user_id FROM email_analysis_jobs j JOIN mail_analysis_settings s ON s.user_id=j.user_id AND s.enabled=1
		WHERE j.version=? AND j.status='pending' AND j.next_attempt_at<=? LIMIT 20`).bind(ANALYSIS_VERSION,now()).all<{ user_id: string }>();
	for (const user of results) await dispatchAnalysis(env, user.user_id);
}
export async function consumeAnalysisQueue(batch: MessageBatch<AnalysisQueueMessage>, env: AnalysisEnv) {
	// Sequential within small batches: protect provider limits and avoid excess calls.
	for (const message of batch.messages) {
		try { await processAnalysisJob(env, message.body); message.ack(); }
		catch { message.retry({ delaySeconds: 60 }); }
	}
}
