import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	MAX_WEBHOOK_BODY_BYTES,
	readBoundedBody,
	utf8ByteLength,
	webhookBodyTooLarge
} from './request-limits';

describe('webhook request limits', () => {
	test('rejects invalid and oversized declared lengths', () => {
		assert.equal(webhookBodyTooLarge(null), false);
		assert.equal(webhookBodyTooLarge(String(MAX_WEBHOOK_BODY_BYTES)), false);
		assert.equal(webhookBodyTooLarge(String(MAX_WEBHOOK_BODY_BYTES + 1)), true);
		assert.equal(webhookBodyTooLarge('-1'), true);
		assert.equal(webhookBodyTooLarge('not-a-number'), true);
	});

	test('measures UTF-8 bytes rather than JavaScript code units', () => {
		assert.equal(utf8ByteLength('mail'), 4);
		assert.equal(utf8ByteLength('📧'), 4);
	});
});

 test('bounded streaming rejects an oversized chunked body and accepts exact limits',async()=>{
  assert.deepEqual([...await readBoundedBody(new Response(new Uint8Array([1,2,3])).body,3)],[1,2,3]);
  await assert.rejects(readBoundedBody(new ReadableStream({start(c){c.enqueue(new Uint8Array(2));c.enqueue(new Uint8Array(2));c.close();}}),3),/too large/);
 });

test('request hook preserves a bounded same-origin JSON body and rejects wrong content types',async()=>{
 const {handle}=await import('../../hooks.server');
 for(const type of ['application/json','text/plain']) {
  let resolved=false;
  const request=new Request('https://mail.test/api/auth/login',{method:'POST',headers:{Origin:'https://mail.test','Content-Type':type},body:JSON.stringify({email:'audit@example.test',password:'synthetic-only'})});
  const result=await handle({event:{request,url:new URL(request.url),cookies:{get:()=>undefined},locals:{}} as any,resolve:async(event)=>{resolved=true;assert.equal((await event.request.json()).email,'audit@example.test');return new Response('ok');}});
  assert.equal(result.status,type==='application/json'?200:415);assert.equal(resolved,type==='application/json');
 }
});
