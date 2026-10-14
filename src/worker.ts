import { consumeAnalysisQueue, reconcileAnalysisJobs, type AnalysisQueueMessage } from './lib/server/mail-analysis-jobs';
import type { ExecutionContext, ScheduledController, MessageBatch } from '@cloudflare/workers-types';
import {
	handleCloudflareInbound,
	type CloudflareInboundEnv,
	type CloudflareInboundMessage
} from './lib/server/cloudflare-inbound';
import { runWeeklyMailAutomations } from './lib/server/mail-automations';
// Renamed from `_worker.js` by `scripts/wrap-cloudflare-worker.mjs` after `vite build`.
// @ts-ignore file and its declaration are created at build time
import sveltekit from '../.svelte-kit/cloudflare/_sveltekit.js';

type SvelteKitWorker = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response;
};

const svelteApp = sveltekit as SvelteKitWorker;

/**
 * SvelteKit's generated Worker is fetch-only. This wrapper keeps HTTP on
 * SvelteKit and adds Cloudflare Email Service's `email()` handler plus the
 * weekly `scheduled()` cleanup of opened mail.
 */
export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		if (typeof svelteApp.fetch !== 'function') {
			throw new Error('SvelteKit worker export is missing fetch');
		}
		return svelteApp.fetch(request, env, ctx);
	},

	async email(message: CloudflareInboundMessage, env: Env, ctx: ExecutionContext) {
		if (env.EMAIL_PROVIDER?.trim().toLowerCase() !== 'cloudflare') {
			message.setReject('Cloudflare email provider is not enabled');
			return;
		}

		const inboundEnv: CloudflareInboundEnv = {
			DB: env.DB,
			SUBQ_API_KEY: env.SUBQ_API_KEY,
			MAIL_ANALYSIS_QUEUE: env.MAIL_ANALYSIS_QUEUE,
			ATTACHMENTS: env.ATTACHMENTS,
			VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
			VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
			VAPID_SUBJECT: env.VAPID_SUBJECT,
			PUBLIC_APP_URL: env.PUBLIC_APP_URL,
			waitUntil: (promise) => ctx.waitUntil(promise)
		};

		await handleCloudflareInbound(message, inboundEnv);
	},

	async queue(batch: MessageBatch<AnalysisQueueMessage>, env: Env) {
		await consumeAnalysisQueue(batch, env);
	},

	async scheduled(controller: ScheduledController, env: Env) {
		try { await reconcileAnalysisJobs(env); }
		catch { console.error('mail analysis reconciliation failed'); }
		if (!['0 8 * * SUN', '0 8 * * 1'].includes(controller.cron)) return;
		const result = await runWeeklyMailAutomations(env);
		console.log('mail automations', result);
	}
};
