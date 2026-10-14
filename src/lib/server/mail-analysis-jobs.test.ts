/// <reference path="../../../node_modules/bun-types/sqlite.d.ts" />
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { listMailbox, insertEmail } from './mail-store';
import { ANALYSIS_VERSION, SUBQ_MODEL } from '../mail-analysis';
import { answers } from './testing/analysis-fixtures';
import { analysisEnabled, setAnalysisEnabled, enqueueAnalysisBackfill, loadMailAnalyses, correctMailAnalysis, continueBackfill, countUnanalyzed, setBackfillAll, backfillAllActive } from './mail-analysis-store';
import { dispatchAnalysis, processAnalysisJob, reconcileAnalysisJobs, consumeAnalysisQueue } from './mail-analysis-jobs';
import { handleCloudflareInbound } from './cloudflare-inbound';
import { handleResendWebhook } from './inbound';
import { authorizeApiRequest } from './api-access';
import { GET as getSettings, PUT as saveSettings } from '../../routes/api/settings/analysis/+server';
import { PATCH as correctAnalysis } from '../../routes/api/mail/[id]/analysis/+server';
let sqlite: Database;
let db: D1Database;

beforeEach(() => {
	sqlite = new Database(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	for (const file of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
		sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	// Execute the production SQL against SQLite, as D1 does.
	db = {
		async batch(statements: { run: () => Promise<unknown> }[]) {
			sqlite.exec('BEGIN');
			try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
			catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
		},
		prepare(sql: string) {
			let values: any[] = [];
			return {
				bind(...args: any[]) { values = args; return this; },
				async all() { return { results: sqlite.query(sql).all(...values) }; },
				async first() { return sqlite.query(sql).get(...values); },
				async run() { return { meta: { changes: sqlite.query(sql).run(...values).changes } }; }
			};
		}
	} as unknown as D1Database;
	sqlite.exec("INSERT INTO users(id,email,name,password_hash) VALUES('owner','owner@example.com','Owner','disabled'),('other','other@example.com','Other','disabled')");
});

afterEach(() => sqlite.close());

async function receive(userId = 'owner') {
 return insertEmail(db, { userId, direction: 'inbound', from:'alex@example.com', to:'owner@example.com', subject:'Project', bodyText:'Can you review by Friday?', analysisMetadata: { replyTo:'alex@example.com' } });
}
const response = () => Response.json({ model: SUBQ_MODEL, answers: answers(), usage: { input_tokens:500, output_tokens:0 } });
const message = (id: string, userId = 'owner') => ({emailId:id,userId,version:ANALYSIS_VERSION});
test('inbound jobs are opt-in, transactional, bounded, and scoped to account', async () => {
 const id = await receive(); assert.equal(await analysisEnabled(db,'owner'),false);
 assert.equal(sqlite.query<{n:number}, []>('SELECT COUNT(*) AS n FROM email_analysis_jobs').get()!.n,0);
 await setAnalysisEnabled(db,'owner',true);
 await receive('other');
 assert.equal(await enqueueAnalysisBackfill(db,'owner'),1);
 assert.equal(await enqueueAnalysisBackfill(db,'owner'),0);
 assert.equal(await correctMailAnalysis(db,'other',id,{category:'work'}),false);
 await processAnalysisJob({DB:db,SUBQ_API_KEY:'test',fetch: (async () => response()) as typeof fetch},message(id,'other'));
 assert.equal(sqlite.query<{n:number}, []>('SELECT COUNT(*) AS n FROM email_analysis').get()!.n,0);
});
test('analysis does not mutate folders, read state, or cleanup and duplicate deliveries do not bill twice', async () => {
 await setAnalysisEnabled(db,'owner',true); const id = await receive(); let calls=0;
 const env={DB:db,SUBQ_API_KEY:'test',fetch:(async () => {calls++;return response();}) as typeof fetch};
 await processAnalysisJob(env,message(id)); await processAnalysisJob(env,message(id));
 assert.equal(calls,1);
 const a=(await loadMailAnalyses(db,'owner',[id])).get(id)!;
 assert.equal(a.category,'work'); assert.equal(a.needsReply,true);
 const e=sqlite.query('SELECT is_read,is_spam,deleted_at FROM emails WHERE id=?').get(id);
 assert.deepEqual(e,{is_read:0,is_spam:0,deleted_at:null});
 assert.equal((await loadMailAnalyses(db,'other',[id])).size,0);
});
test('opt-out during provider call prevents saving a late answer', async () => {
 await setAnalysisEnabled(db,'owner',true); const id=await receive();
 await processAnalysisJob({DB:db,SUBQ_API_KEY:'test',fetch:(async () => { await setAnalysisEnabled(db,'owner',false); return response(); }) as typeof fetch},message(id));
 assert.equal(sqlite.query<{n:number}, []>('SELECT COUNT(*) AS n FROM email_analysis').get()!.n,0);
});
test('corrections survive inference, linked sent replies clear reply hints, drafts do not', async () => {
 await setAnalysisEnabled(db,'owner',true); const id=await receive();
 await correctMailAnalysis(db,'owner',id,{category:'personal'});
 await processAnalysisJob({DB:db,SUBQ_API_KEY:'test',fetch:(async () => response()) as typeof fetch},message(id));
 let a=(await loadMailAnalyses(db,'owner',[id])).get(id)!; assert.equal(a.category,'personal');assert.equal(a.corrected,true);
 const sent=await insertEmail(db,{userId:'owner',direction:'outbound',from:'owner@example.com',to:'alex@example.com',subject:'Re: Project',replyToEmailId:id,status:'draft'});
 assert.equal((await loadMailAnalyses(db,'owner',[id])).get(id)!.needsReply,true);
 sqlite.query("UPDATE emails SET status='sent' WHERE id=?").run(sent);
 a=(await loadMailAnalyses(db,'owner',[id])).get(id)!;assert.equal(a.needsReply,false);assert.equal(a.deadline,true);
 await correctMailAnalysis(db,'owner',id,{taskDone:true});
 assert.equal((await loadMailAnalyses(db,'owner',[id])).get(id)!.deadline,false);
});
test('rate limits persist backoff and pause, malformed responses become Review failures', async () => {
 await setAnalysisEnabled(db,'owner',true); const id=await receive();let calls=0;
 const env={DB:db,SUBQ_API_KEY:'test',fetch:(async () => {calls++;return new Response('',{status:429});}) as typeof fetch};
 await processAnalysisJob(env,message(id));await processAnalysisJob(env,message(id));assert.equal(calls,1);
 assert.equal(sqlite.query<{status:string}, [string]>('SELECT status FROM email_analysis_jobs WHERE email_id=?').get(id)!.status,'pending');
 sqlite.exec('DELETE FROM mail_analysis_provider_state; UPDATE email_analysis_jobs SET next_attempt_at=0');
 await processAnalysisJob({...env,fetch:(async () => Response.json({})) as typeof fetch},message(id));
 const a=(await loadMailAnalyses(db,'owner',[id])).get(id)!;assert.equal(a.status,'failed');assert.equal(a.review,true);
});
test('queue failure and expired leases remain recoverable without accepting deleted messages', async () => {
 await setAnalysisEnabled(db,'owner',true);const id=await receive();
 await dispatchAnalysis({DB:db,SUBQ_API_KEY:'test',MAIL_ANALYSIS_QUEUE:{send:async () => {throw Error('offline');}} as any},'owner',id);
 assert.equal(sqlite.query<{status:string}, [string]>('SELECT status FROM email_analysis_jobs WHERE email_id=?').get(id)!.status,'pending');
 sqlite.exec("UPDATE email_analysis_jobs SET status='processing',lease_until=0,lease_token='expired'");
 await reconcileAnalysisJobs({DB:db,SUBQ_API_KEY:'test',fetch:(async () => response()) as typeof fetch});
 assert.equal((await loadMailAnalyses(db,'owner',[id])).get(id)!.status,'analyzed');
 const deleted=await receive();sqlite.query("UPDATE emails SET deleted_at=datetime('now') WHERE id=?").run(deleted);
 let calls=0;await processAnalysisJob({DB:db,SUBQ_API_KEY:'test',fetch:(async () => {calls++;return response();}) as typeof fetch},message(deleted));assert.equal(calls,0);
});

test('conversation category, warnings, task filters and pagination agree with displayed analysis', async () => {
 await setAnalysisEnabled(db,'owner',true); const id=await receive();
 await processAnalysisJob({DB:db,SUBQ_API_KEY:'test',fetch:(async () => response()) as typeof fetch},message(id));
 for(const q of ['category:primary','category:work','needs:reply','needs:deadline','needs:attention']) {
  const page=await listMailbox(db,'owner',{view:'inbox',q,pageSize:1});assert.equal(page.total,1,q);assert.equal(page.threads[0].analysis?.category,'work');
 }
 assert.equal((await listMailbox(db,'owner',{view:'inbox',q:'risk:phishing'})).total,0);
 await correctMailAnalysis(db,'owner',id,{category:'transaction',taskDone:true});
 assert.equal((await listMailbox(db,'owner',{view:'inbox',category:'transactions'})).total,1);
 assert.equal((await listMailbox(db,'owner',{view:'inbox',q:'needs:reply'})).total,0);
 assert.equal((await listMailbox(db,'other',{view:'inbox',q:'category:transactions'})).total,0);
 const newer=await receive();sqlite.query("UPDATE emails SET created_at='2100-01-01' WHERE id=?").run(newer);
 await processAnalysisJob({DB:db,SUBQ_API_KEY:'test',fetch:(async () => {const a=answers(0.5);a.phishing.noul=0.8;return Response.json({model:SUBQ_MODEL,answers:a,usage:{input_tokens:500,output_tokens:0}});}) as typeof fetch},message(newer));
 const page=await listMailbox(db,'owner',{view:'inbox',q:'needs:review'});assert.equal(page.total,1);assert.equal(page.threads[0].analysis?.phishing,true);assert.equal(page.threads[0].analysis?.category,null);
 assert.equal((await listMailbox(db,'owner',{view:'inbox',q:'category:transaction'})).total,0);
 await correctMailAnalysis(db,'owner',newer,{category:'work',warningDismissed:true});
 assert.equal((await listMailbox(db,'owner',{view:'inbox',q:'needs:review'})).total,0);
});

test('a newer informational message supersedes old task suggestions but preserves old security warnings', async () => {
 await setAnalysisEnabled(db,'owner',true); const id=await receive();
 const env={DB:db,SUBQ_API_KEY:'test',fetch:(async()=>response()) as typeof fetch};
 await processAnalysisJob(env,message(id));
 const newer=await receive(); sqlite.query("UPDATE emails SET created_at='2100-01-01' WHERE id=?").run(newer);
 await processAnalysisJob({...env,fetch:(async()=>{const a=answers();a.needs_reply.noul=0.1;a.deadline.noul=0.1;return Response.json({model:SUBQ_MODEL,answers:a,usage:{input_tokens:500,output_tokens:0}});}) as typeof fetch},message(newer));
 assert.equal((await listMailbox(db,'owner',{view:'inbox',q:'needs:reply'})).total,0);
 assert.equal((await listMailbox(db,'owner',{view:'inbox'})).threads[0].analysis?.needsReply,false);
 sqlite.query('UPDATE email_analysis SET phishing=1 WHERE email_id=?').run(id);
 assert.equal((await listMailbox(db,'owner',{view:'inbox',q:'risk:phishing'})).total,1);
 assert.equal((await listMailbox(db,'owner',{view:'inbox'})).threads[0].analysis?.phishing,true);
});

test('settings require a configured key, and corrections require an owner browser session', async () => {
 const id=await receive();
 const locals={user:{id:'owner'},authMethod:'session'},platform={env:{DB:db,SUBQ_API_KEY:'test'}};
 const event=(body:unknown)=>({locals,platform,request:new Request('http://localhost/api/settings/analysis',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}) as any;
 const keyless={locals,platform:{env:{DB:db}},request:new Request('http://localhost/api/settings/analysis',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true})})} as any;
 assert.equal((await saveSettings(keyless)).status,400);
 assert.equal(await analysisEnabled(db,'owner'),false);
 assert.equal((await saveSettings(event({enabled:true}))).status,200);
 assert.equal(await analysisEnabled(db,'owner'),true);
 const current=await (await getSettings({locals,platform} as any)).json();assert.equal(current.available,true);assert.equal(current.enabled,true);
 const correction=(body:unknown,userId='owner',authMethod='session')=>({locals:{user:{id:userId},authMethod},platform,params:{id},request:new Request('http://localhost/api/mail/x/analysis',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}) as any;
 assert.equal((await correctAnalysis(correction({category:'work'},'other'))).status,404);
 assert.equal((await correctAnalysis(correction({category:'work'},'owner','api_token'))).status,403);
 assert.equal((await correctAnalysis(correction({category:'made-up'}))).status,400);
 assert.equal((await correctAnalysis(correction({category:'work'}))).status,200);
 for(const path of ['/api/settings/analysis','/api/mail/received/analysis']) assert.equal(authorizeApiRequest({pathname:path,method:'PATCH',authMethod:'api_token',scopes:['mail:read','mail:send','admin']}).ok,false);
 assert.equal((await saveSettings(event({enabled:false}))).status,200);
});

test('both providers preserve recipient context and dispatch ID-only queue messages after inbound storage', async () => {
 await setAnalysisEnabled(db,'owner',true);
 sqlite.exec("UPDATE users SET is_admin=1 WHERE id='owner'; INSERT INTO domains(id,name) VALUES('domain','example.com'); INSERT INTO addresses(id,user_id,domain_id,address) VALUES('address','owner','domain','owner@example.com')");
 const sent:any[]=[];
 const env={DB:db,ATTACHMENTS:{},SUBQ_API_KEY:'test',MAIL_ANALYSIS_QUEUE:{send:async(body:unknown)=>{sent.push(body);}}} as any;
 await handleCloudflareInbound({from:'bounce@example.test',to:'owner@example.com',headers:new Headers({'to':'teammate@example.com','cc':'owner@example.com'}),raw:new Response('From: Alex <alex@example.test>\r\nTo: teammate@example.com\r\nCc: owner@example.com\r\nSubject: Synthetic Cloudflare message\r\nMessage-ID: <cf-qa@example.test>\r\nContent-Type: text/plain\r\n\r\nFYI only.').body!,setReject(){throw Error('unexpected rejection');}},env);
 await handleResendWebhook({type:'email.received',data:{email_id:'resend-qa'}},env,{getReceivedEmail:async()=>({from:'alex@example.test',to:['teammate@example.com'],cc:['owner@example.com'],subject:'Synthetic Resend message',text:'FYI only.',html:null,headers:{'Reply-To':'alex@example.test'}}),listReceivedAttachments:async()=>[]} as any);
 assert.equal(sent.length,2);
 for(const item of sent) {
  assert.deepEqual(Object.keys(item).sort(),['emailId','userId','version']);assert.equal(item.userId,'owner');
  const row=sqlite.query<{metadata_json:string},[string]>('SELECT metadata_json FROM email_analysis_metadata WHERE email_id=?').get(item.emailId)!;
  const metadata=JSON.parse(row.metadata_json);assert.deepEqual(metadata.visibleTo,['teammate@example.com']);assert.deepEqual(metadata.visibleCc,['owner@example.com']);
 }
 let acked=0;
 await consumeAnalysisQueue({messages:sent.map(body=>({body,ack(){acked++;},retry(){throw Error('unexpected retry');}}))} as any,{DB:db,SUBQ_API_KEY:'test',fetch:(async()=>response()) as typeof fetch});
 assert.equal(acked,2);
 assert.equal((await loadMailAnalyses(db,'owner',sent.map(m=>m.emailId))).size,2);
});

test('same-second inbound messages use insertion order so retractions supersede requests', async () => {
 await setAnalysisEnabled(db,'owner',true);const first=await receive(),second=await receive();
 sqlite.exec("UPDATE emails SET created_at='2026-01-01 00:00:00'");
 const env={DB:db,SUBQ_API_KEY:'test',fetch:(async()=>response()) as typeof fetch};
 await processAnalysisJob(env,message(first));
 await processAnalysisJob({...env,fetch:(async()=>{const a=answers();a.needs_reply.noul=0;a.deadline.noul=0;return Response.json({model:SUBQ_MODEL,answers:a,usage:{input_tokens:500,output_tokens:0}});}) as typeof fetch},message(second));
 const page=await listMailbox(db,'owner',{view:'inbox'});
 assert.equal(page.threads[0].analysisMessageId,second);
 assert.equal(page.threads[0].analysis?.needsReply,false);
 assert.equal((await listMailbox(db,'owner',{view:'inbox',q:'needs:reply'})).total,0);
});

test('0024 migration re-derives categories for rows previously hidden by the 0.90 cutoff', async () => {
 const hidden = await receive(), unsure = await receive(), flagged = await receive();
 const insert = sqlite.query(`INSERT INTO email_analysis(email_id,user_id,version,model,input_hash,category,predicted_category,confidence,review,phishing,spam,needs_reply,deadline,urgency,answers_json,input_tokens)
  VALUES(?,'owner',?,?,'h',NULL,?,?,1,?,0,0,0,0,'{}',1)`);
 insert.run(hidden, ANALYSIS_VERSION, SUBQ_MODEL, 'promotion', 0.8, 0);
 insert.run(unsure, ANALYSIS_VERSION, SUBQ_MODEL, 'notification', 0.45, 0);
 insert.run(flagged, ANALYSIS_VERSION, SUBQ_MODEL, 'transaction', 0.85, 1);
 sqlite.exec(readFileSync('migrations/0024_category_threshold.sql', 'utf8'));
 const row = (id: string) => sqlite.query<{category:string|null;review:number}, [string]>('SELECT category,review FROM email_analysis WHERE email_id=?').get(id)!;
 assert.deepEqual(row(hidden), { category: 'promotion', review: 0 });
 assert.deepEqual(row(unsure), { category: null, review: 1 });
 assert.deepEqual(row(flagged), { category: 'transaction', review: 1 });
});

test('analyze-all keeps queueing bounded batches from cron until the backlog is gone, then stops itself', async () => {
 for (let i=0;i<5;i++) await receive();
 await setAnalysisEnabled(db,'owner',true);
 assert.equal(await countUnanalyzed(db,'owner'),5);
 assert.equal(await continueBackfill(db,'owner',2),0, 'does nothing until requested');
 await setBackfillAll(db,'owner',true);
 const env={DB:db,SUBQ_API_KEY:'test',fetch:(async()=>response()) as typeof fetch};
 let rounds=0;
 while (await backfillAllActive(db,'owner') && rounds++<10) {
  await continueBackfill(db,'owner',2); await reconcileAnalysisJobs(env); await dispatchAnalysis(env,'owner');
 }
 assert.equal(await countUnanalyzed(db,'owner'),0);
 assert.equal(await backfillAllActive(db,'owner'),false);
 assert.equal(sqlite.query<{n:number},[]>("SELECT COUNT(*) AS n FROM email_analysis").get()!.n,5);
});
test('turning analysis off cancels analyze-all', async () => {
 await receive(); await setAnalysisEnabled(db,'owner',true); await setBackfillAll(db,'owner',true);
 assert.equal(await backfillAllActive(db,'owner'),true);
 await setAnalysisEnabled(db,'owner',false);
 await setAnalysisEnabled(db,'owner',true);
 assert.equal(await backfillAllActive(db,'owner'),false);
});
