import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebhookHandler} from '../api/asaas-webhook.js';
import {validWebhookToken,normalizeBillingResource,handleBillingEvent} from '../api/_lib/billingEvents.js';
import {createOperationsHandler,validOperationsToken} from '../api/operations.js';
import {AccessError} from '../api/_lib/workspaces.js';
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
test('webhooks authenticate before obtaining database access and retry pending links',async()=>{
 const previous=process.env.ASAAS_WEBHOOK_TOKEN;process.env.ASAAS_WEBHOOK_TOKEN='ab'.repeat(32);
 try {
  let accesses=0;const handler=createWebhookHandler(()=>{accesses++;return {};},async()=>({status:'deferred'}));
  let res=response();await handler({method:'POST',headers:{},body:{}},res);assert.equal(res.statusCode,401);assert.equal(accesses,0);
  res=response();await handler({method:'POST',headers:{'asaas-access-token':process.env.ASAAS_WEBHOOK_TOKEN},body:{}},res);assert.equal(res.statusCode,503);assert.equal(accesses,1);
  assert.equal(validWebhookToken(['bad']),false);assert.equal(validWebhookToken('short','short'),false);
 }finally{if(previous===undefined)delete process.env.ASAAS_WEBHOOK_TOKEN;else process.env.ASAAS_WEBHOOK_TOKEN=previous;}
});
test('payment normalization excludes payer secrets and rejects foreign invoice URLs',()=>{
 const normalized=normalizeBillingResource('payment',{id:'pay_a',subscription:'sub_a',customer:'cus_a',value:59.9,status:'OVERDUE',cpfCnpj:'sensitive',invoiceUrl:'https://attacker.invalid',dueDate:'2026-11-15'});
 assert.equal(normalized.value_cents,5990);assert.equal(normalized.invoice_url,null);assert.equal('cpfCnpj' in normalized,false);
 assert.throws(()=>normalizeBillingResource('payment',{value:Infinity}));
});
test('webhooks consult current provider state instead of applying stale event names',async()=>{
 const calls=[];
 const admin={from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:{subscription_id:'sub_a'}};}};},async rpc(name,args){calls.push({name,args});return {data:{status:'applied'}};}};
 await handleBillingEvent(admin,{id:'evt_a',event:'PAYMENT_OVERDUE',payment:{id:'pay_a'}},async()=>({id:'pay_a',subscription:'sub_a',customer:'cus_a',value:59.9,status:'RECEIVED'}));
 assert.equal(calls[0].args.p_data.status,'RECEIVED');
});
test('maintenance rejects unauthenticated and barber requests before running backups',async()=>{
 let backups=0;const handler=createOperationsHandler({context:async req=>{if(!req.headers.authorization)throw new AccessError('Sem sessão',401);return {actor:{role:'barbeiro',ativo:true}};},backup:async()=>{backups++;}});
 for(const headers of [{},{authorization:'Bearer invalid'}]){const res=response();await handler({method:'POST',headers,body:{action:'backup'}},res);assert.ok([401,403].includes(res.statusCode));}
 assert.equal(backups,0);assert.equal(validOperationsToken('Bearer short','short'),false);
});
