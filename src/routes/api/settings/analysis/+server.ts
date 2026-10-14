import { json, type RequestHandler } from '@sveltejs/kit';
import { analysisEnabled, setAnalysisEnabled, enqueueAnalysisBackfill } from '$lib/server/mail-analysis-store';
import { dispatchAnalysis } from '$lib/server/mail-analysis-jobs';
import { ANALYSIS_VERSION } from '$lib/mail-analysis';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user || !platform?.env.DB) return json({error:'Unauthorized'},{status:401});
	if (locals.authMethod !== 'session') return json({error:'Sign in with a browser session.'},{status:403});
	const db=platform.env.DB,userId=locals.user.id;
	const {results:counts}=await db.prepare('SELECT status,COUNT(*) AS count FROM email_analysis_jobs WHERE user_id=? AND version=? GROUP BY status').bind(userId,ANALYSIS_VERSION).all<{status:string;count:number}>();
	const provider=await db.prepare('SELECT pause_until,error_code FROM mail_analysis_provider_state WHERE id=1').first<{pause_until:number;error_code:string}>();
	return json({enabled:await analysisEnabled(db,userId),available:Boolean(platform.env.SUBQ_API_KEY),counts,providerError:provider && provider.pause_until>Math.floor(Date.now()/1000) ? provider.error_code : null});
};
export const PUT: RequestHandler = async ({ request,locals,platform }) => {
	if (!locals.user || !platform?.env.DB) return json({error:'Unauthorized'},{status:401});
	if (locals.authMethod !== 'session') return json({error:'Sign in with a browser session.'},{status:403});
	const input=await request.json().catch(()=>null);
	if (!input || typeof input.enabled!=='boolean') return json({error:'Choose whether incoming analysis is enabled.'},{status:400});
	if (input.enabled && (!platform.env.SUBQ_API_KEY || input.zdrConfirmed!==true)) return json({error:'Configure SubQ and confirm organization zero data retention is active before enabling analysis.'},{status:400});
	await setAnalysisEnabled(platform.env.DB,locals.user.id,input.enabled);
	return json({enabled:input.enabled});
};
export const POST: RequestHandler = async ({ request,locals,platform }) => {
	if (!locals.user || !platform?.env.DB) return json({error:'Unauthorized'},{status:401});
	if (locals.authMethod !== 'session') return json({error:'Sign in with a browser session.'},{status:403});
	const db=platform.env.DB,userId=locals.user.id;
	if (!platform.env.SUBQ_API_KEY || !await analysisEnabled(db,userId)) return json({error:'Enable incoming analysis first.'},{status:400});
	const body=await request.json().catch(()=>null);
	let queued=0;
	if (body?.action==='backfill') queued=await enqueueAnalysisBackfill(db,userId);
	else if (body?.action==='retry') {
		const r=await db.prepare("UPDATE email_analysis_jobs SET status='pending',attempts=0,next_attempt_at=0,queued_until=0,error_code=NULL WHERE user_id=? AND version=? AND status='failed'").bind(userId,ANALYSIS_VERSION).run();queued=r.meta.changes;
	} else return json({error:'Choose backfill or retry.'},{status:400});
	const work=dispatchAnalysis(platform.env,userId).catch(()=>undefined);
	if (platform.ctx) platform.ctx.waitUntil(work);else await work;
	return json({queued});
};
