import { json, type RequestHandler } from '@sveltejs/kit';
import { isMailCategory } from '$lib/mail-analysis';
import { correctMailAnalysis } from '$lib/server/mail-analysis-store';

export const PATCH: RequestHandler = async ({request,locals,platform,params}) => {
	if (!locals.user || !platform?.env.DB) return json({error:'Unauthorized'},{status:401});
	if (locals.authMethod!=='session') return json({error:'Sign in with a browser session.'},{status:403});
	const input=await request.json().catch(()=>null);
	if (!input || typeof input!=='object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(k=>!['category','warningDismissed','taskDone'].includes(k)) ||
		(input.category!==undefined && input.category!==null && !isMailCategory(input.category)) ||
		(input.warningDismissed!==undefined && typeof input.warningDismissed!=='boolean') ||
		(input.taskDone!==undefined && typeof input.taskDone!=='boolean')) return json({error:'Invalid correction.'},{status:400});
	if (!await correctMailAnalysis(platform.env.DB,locals.user.id,params.id!,input)) return json({error:'Message not found.'},{status:404});
	return json({ok:true});
};
