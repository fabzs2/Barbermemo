import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { safeRoute, sanitizeEvent } from '../monitoring/privacy.js';
import { verifySignature, alertText, deliverTelegram } from '../api/_lib/sentryWebhook.js';
import health from '../api/health.js';
import { withMonitoring } from '../api/_lib/monitoring.js';
function response() {
  return { statusCode:200, headers:{}, setHeader(k,v){this.headers[k]=v;}, status(n){this.statusCode=n;return this;}, json(body){this.body=body;return this;} };
}
test('removes payloads, identity, breadcrumbs, sensitive error values and query strings', () => {
  const event = sanitizeEvent({ user:{email:'private@example.com'},request:{data:{senha:'secret'}},extra:{phone:'123456789'},breadcrumbs:[{message:'private'}],exception:{values:[{value:'Failed for "Private Name" private@example.com +5511999999999',stacktrace:{frames:[{filename:'https://app.test/app.js?token=secret',vars:{senha:'secret'}}]}}]}, tags:{operation:'addCliente',token:'secret'} });
  const output=JSON.stringify(event);
  for (const value of ['private@example.com','Private Name','5511999999999','secret','breadcrumbs','request','vars']) assert.ok(!output.includes(value),value);
  assert.equal(event.tags.operation,'addCliente');
  assert.equal(safeRoute('/clientes/123e4567-e89b-12d3-a456-426614174000?token=x'),'/clientes/:id');
});
test('HMAC accepts exact signed bytes; rejects altered, missing or malformed signatures', () => {
  const raw=Buffer.from('{ "action": "triggered" }');
  const signature=createHmac('sha256','test-secret').update(raw).digest('hex');
  assert.equal(verifySignature(raw,signature,'test-secret'),true);
  assert.equal(verifySignature(Buffer.from('{}'),signature,'test-secret'),false);
  assert.equal(verifySignature(raw,undefined,'test-secret'),false);
  assert.equal(verifySignature(raw,'00','test-secret'),false);
});
test('Telegram alert excludes raw customer errors and non-Sentry links', () => {
  const text=alertText({data:{event:{title:'private name',message:'private email',web_url:'https://evil.test',release:'v1',tags:[['operation','addCliente']]}}});
  assert.ok(text.includes('addCliente')); assert.ok(!text.includes('private')); assert.ok(!text.includes('evil'));
});
test('health degrades on dependency failure, uses no-store, does not return rows', async () => {
  const oldFetch=globalThis.fetch;const oldUrl=process.env.SUPABASE_URL;const oldKey=process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL='https://test.invalid';process.env.SUPABASE_ANON_KEY='public';
  try {
    globalThis.fetch=async url => ({ok:!url.includes('rest/v1')});
    const res=response();await health({method:'GET'},res);
    assert.equal(res.statusCode,503);assert.equal(res.headers['Cache-Control'],'no-store');assert.deepEqual(res.body.checks,{auth:true,database:false});
    globalThis.fetch=async()=>({ok:true});const healthy=response();await health({method:'GET'},healthy);assert.equal(healthy.statusCode,200);
  } finally {globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=oldKey;}
});
test('API wrapper preserves success and handles an uncaught error without disclosing it', async()=>{
  const res=response();await withMonitoring('test',async()=>{throw new Error('private data');})({},res);
  assert.equal(res.statusCode,500);assert.ok(!JSON.stringify(res.body).includes('private'));
  const success=response();await withMonitoring('test',async(req,r)=>r.json({ok:true}))({},success);assert.deepEqual(success.body,{ok:true});
});
test('Telegram delivery retries failures and never exposes token in error', async()=>{
  const old=globalThis.fetch;const token=process.env.TELEGRAM_BOT_TOKEN;const chat=process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN='fake-token';process.env.TELEGRAM_CHAT_ID='fake-chat';let calls=0;
  try {globalThis.fetch=async()=>{calls++;throw new Error('fake-token');};await assert.rejects(deliverTelegram('test'),e=>!e.message.includes('fake-token'));assert.equal(calls,2);}
  finally {globalThis.fetch=old;if(token===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=token;if(chat===undefined)delete process.env.TELEGRAM_CHAT_ID;else process.env.TELEGRAM_CHAT_ID=chat;}
});
