import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answers } from './testing/analysis-fixtures';
import { SUBQ_MODEL } from '../mail-analysis';
import { buildAnalysisState, inboundAnalysisMetadata, parseSubqResponse, requestSubq, SubqError } from './subq';
const input = { from: 'alex@example.com', to: 'owner@example.com', subject: 'Project' };
test('extracts link evidence without executable HTML or tracking credentials', () => {
	const state = buildAnalysisState({ ...input, bodyHtml: '<style>secret-css</style><p>Please review.</p><a href="https://evil.example/login?token=secret">bank.example</a><blockquote>Old reply request</blockquote>' });
	assert.equal(state.body, 'Please review.\nbank.example');
	assert.deepEqual(state.links, [{ text: 'bank.example', destination: 'https://evil.example/login' }]);
	assert.equal(JSON.stringify(state).includes('secret'), false);
});
test('keeps forwarded evidence, removes quoted replies and redacts verification codes', () => {
	const state = buildAnalysisState({ ...input, bodyText: 'Security code: 123456\nOn Tuesday someone wrote:\n> reply now' });
	assert.equal(state.body, 'Security code: [code]');
	assert.match(buildAnalysisState({ ...input, bodyText: 'Please investigate\n-----Forwarded Message-----\nSuspicious bank request' }).body, /Suspicious bank/);
});
test('headers are case-insensitive and authentication claims are explicitly unverified', () => {
	const metadata = inboundAnalysisMetadata({ 'Reply-To': 'other@example.com', 'Authentication-Results': 'fake; dmarc=pass', 'List-Unsubscribe': '<https://example.com>' }, 'resend');
	const state = buildAnalysisState({ ...input, metadata });
	assert.equal(state.headers.reply_to, 'other@example.com');
	assert.equal(state.headers.has_list_unsubscribe, true);
	assert.equal(state.headers.auth_results.verified, false);
});
test('preserves CC-only recipient context, forwarded requests and legitimate plaintext code', () => {
	const state=buildAnalysisState({...input,metadata:{visibleTo:['teammate@example.test'],visibleCc:[input.to]},bodyText:'FYI only.\nOn Tuesday Alex\nwrote:\n> Reply by Friday'});
	assert.equal(state.headers.to,'teammate@example.test');assert.equal(state.headers.recipient,input.to);assert.equal(state.body,'FYI only.');
	assert.match(buildAnalysisState({...input,subject:'Fwd: Suspicious request',bodyHtml:'<p>Please investigate</p><blockquote>Send your password now</blockquote>'}).body,/password/);
	assert.match(buildAnalysisState({...input,bodyText:'Please review: body { font-family: Arial; }'}).body,/font-family/);
	assert.equal(buildAnalysisState({...input,bodyText:'body { font-family: Arial; } Hello',bodyHtml:'<style>body { font-family: Arial; }</style><p>Hello</p>'}).body,'Hello');
});
test('validates complete typed answers and rejects partial, nonfinite or unknown values', () => {
	const raw = { model: SUBQ_MODEL, answers: answers(), usage: { input_tokens: 400, output_tokens: 0 } };
	assert.ok(parseSubqResponse(raw));
	assert.equal(parseSubqResponse({ ...raw, model: 'wrong' }), null);
	for (const mutate of [(a: any) => { a.folder.choice = 'invented'; }, (a: any) => { a.phishing.noul = NaN; }, (a: any) => { delete a.spam; }, (a: any) => { a.folder.probabilities.work = 0.5; }]) {
		const a = answers(); mutate(a); assert.equal(parseSubqResponse({ ...raw, answers: a }), null);
	}
});
test('adapter sends one six-question request with no retained metadata and handles retries safely', async () => {
	let calls = 0;
	const fetcher = (async (_url: string, init: RequestInit) => {
		calls++; const body = JSON.parse(String(init.body));
		assert.equal(Object.keys(body.questions).length, 6); assert.equal(body.metadata, undefined);
		return Response.json({ model: SUBQ_MODEL, answers: answers(), usage: { input_tokens: 400, output_tokens: 0 } });
	}) as typeof fetch;
	assert.equal((await requestSubq('test-secret', buildAnalysisState(input), fetcher)).inputTokens, 400);
	assert.equal(calls, 1);
	await assert.rejects(requestSubq('test-secret', buildAnalysisState(input), (async () => new Response('private-provider-error', { status: 429, headers: { 'Retry-After': '20' } })) as typeof fetch), (e: unknown) => e instanceof SubqError && e.retryable && e.retryAfterSeconds === 20 && !e.message.includes('private'));
	await assert.rejects(requestSubq('test-secret', buildAnalysisState(input), (async () => new Response('', { status: 402 })) as typeof fetch), (e: unknown) => e instanceof SubqError && !e.retryable);
});
