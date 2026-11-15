import test from 'node:test';
import assert from 'node:assert/strict';
import {activateWorkspaceBilling,payerInput,safeInvoiceUrl} from '../api/_lib/billing.js';
import {validDocument,PLAN_PRICES,brazilDate} from '../src/domain/billing.js';

function harness({plan='individual',lostSubscription=false,lostCustomer=false,rejectSubscription=false,noVisibleSubscription=false}={}) {
 const actor={id:'root',role:'super_admin',ativo:true};
 const workspace={id:'workspace',owner_id:'owner',plano:plan,status:'pilot'};
 const payer={id:'owner',nome:'Fixture owner',email:'fixture@example.invalid',cpf_cnpj:'52998224725',telefone:'11999999999',ativo:true};
 let state={state:'none',plan,amount_cents:PLAN_PRICES[plan],first_due_date:brazilDate(),customer_attempted:false,subscription_attempted:false,customer_id:null,subscription_id:null};
 const customers=[],subscriptions=[],requests=[];let first=true,customerFirst=true,lease=0;
 const result=(data)=>{const q={then:(resolve,reject)=>Promise.resolve({data,error:null}).then(resolve,reject)};for(const key of ['select','eq','maybeSingle','single','update'])q[key]=()=>q;return q;};
 const admin={from:()=>result(payer),rpc:async(name,args)=>{
  if(name==='begin_workspace_billing'){if(state.state==='creating')return {data:{acquired:false}};state={...state,state:'creating'};return {data:{acquired:true,lease:String(++lease),billing:{...state}}};}
  const action=args.p_action,values=args.p_values;
  if(action==='customer_attempt')state.customer_attempted=true;
  if(action==='customer_saved')state.customer_id=values.customer_id;
  if(action==='subscription_attempt')state.subscription_attempted=true;
  if(action==='complete'){state.subscription_id=values.subscription_id;state.state='ready';workspace.status='active';}
  if(action==='uncertain')state.state='uncertain';
  if(action==='rejected'){state.state='error';if(values.stage==='subscription_post')state.subscription_attempted=false;if(values.stage==='customer_post')state.customer_attempted=false;}
  return {data:{...state}};
 }};
 const provider=async(path,options={})=>{
  requests.push({path,method:options.method||'GET',body:options.body&&JSON.parse(options.body)});
  const u=new URL(path,'https://mock.invalid');
  if(u.pathname==='/customers'&&options.method==='POST'){
   const customer={id:'cus_fixture',...JSON.parse(options.body)};customers.push(customer);
   if(lostCustomer&&customerFirst){customerFirst=false;throw new Error('timeout');}return customer;
  }
  if(u.pathname==='/customers')return {data:customers};
  if(u.pathname==='/customers/cus_fixture')return customers[0]||{id:'cus_fixture',externalReference:'owner'};
  if(u.pathname==='/subscriptions/sub_fixture/payments')return {data:[{status:'PENDING',dueDate:brazilDate(),invoiceUrl:'https://www.asaas.com/i/fixture'}]};
  if(u.pathname==='/subscriptions/sub_fixture')return subscriptions[0];
  if(u.pathname==='/subscriptions'&&options.method==='POST'){
   if(rejectSubscription){const error=new Error('Rejected');error.status=400;throw error;}
   const sub={id:'sub_fixture',status:'ACTIVE',...JSON.parse(options.body)};subscriptions.push(sub);
   if(lostSubscription&&first){first=false;throw new Error('timeout');}return sub;
  }
  if(u.pathname==='/subscriptions')return {data:noVisibleSubscription?[]:subscriptions};
  throw new Error('Unexpected provider call');
 };
 const body={cpfCnpj:payer.cpf_cnpj,firstDueDate:brazilDate(),confirmBilling:true,expectedPlan:plan,expectedAmountCents:PLAN_PRICES[plan]};
 return {admin,actor,workspace,provider,body,requests,customers,subscriptions,state:()=>state};
}
const run=h=>activateWorkspaceBilling(h);
const posts=(h,path)=>h.requests.filter(r=>r.method==='POST'&&r.path===path);

test('validates CPF/CNPJ checksums and rejects invalid or missing payer documents',()=>{
 assert.equal(validDocument('529.982.247-25'),true);assert.equal(validDocument('11.222.333/0001-81'),true);
 for(const doc of ['11111111111','52998224724','11222333000182','','fake'])assert.equal(validDocument(doc),false);
 assert.throws(()=>payerInput({},true),{status:400});assert.deepEqual(payerInput({},false),{cpfCnpj:'',telefone:''});
 assert.equal(safeInvoiceUrl('https://www.asaas.com/i/fixture'),'https://www.asaas.com/i/fixture');
 for(const url of ['http://www.asaas.com/i/x','https://asaas.com.evil.invalid/x','javascript:alert(1)'])assert.equal(safeInvoiceUrl(url),null);
});
for(const [plan,cents]of Object.entries(PLAN_PRICES))test(`activates ${plan} with confirmed monthly PIX price and one subscription`,async()=>{
 const h=harness({plan});const response=await run(h);
 assert.equal(response.amountCents,cents);assert.equal(h.workspace.status,'active');
 assert.equal(posts(h,'/customers').length,1);assert.equal(posts(h,'/subscriptions').length,1);
 const body=posts(h,'/subscriptions')[0].body;
 assert.equal(body.value,cents/100);assert.equal(body.billingType,'PIX');assert.equal(body.cycle,'MONTHLY');assert.equal(body.externalReference,'barbermemo:workspace');
 assert.equal(response.invoiceUrl,'https://www.asaas.com/i/fixture');
 await run(h);assert.equal(posts(h,'/subscriptions').length,1,'Reactivation cannot generate a second subscription');
});
test('requires super admin, valid payer, fresh plan, due date and explicit billing confirmation before provider calls',async()=>{
 for(const mutate of [h=>h.actor.role='dono',h=>h.body.confirmBilling=false,h=>h.body.expectedAmountCents=1,h=>h.body.cpfCnpj='11111111111',h=>h.body.firstDueDate='2026-02-30']){
  const h=harness();mutate(h);await assert.rejects(run(h));assert.equal(h.requests.length,0);
 }
});
test('reconciles a lost customer response by external reference instead of creating a duplicate customer',async()=>{
 const h=harness({lostCustomer:true});await assert.rejects(run(h),{status:502});assert.equal(h.workspace.status,'pilot');
 await run(h);assert.equal(posts(h,'/customers').length,1);assert.equal(posts(h,'/subscriptions').length,1);
});
test('reconciles a lost subscription response without creating a second charge',async()=>{
 const h=harness({lostSubscription:true});await assert.rejects(run(h),{status:502});assert.equal(h.workspace.status,'pilot');assert.equal(h.state().subscription_attempted,true);
 await run(h);assert.equal(h.workspace.status,'active');assert.equal(posts(h,'/subscriptions').length,1);
});
test('ambiguous subscription creation is never replayed while lookup still returns no result',async()=>{
 const h=harness({lostSubscription:true,noVisibleSubscription:true});await assert.rejects(run(h),{status:502});
 await assert.rejects(run(h),{status:409});assert.equal(posts(h,'/subscriptions').length,1);assert.equal(h.workspace.status,'pilot');
});
test('definitive provider validation errors preserve pilot access and allow a corrected attempt',async()=>{
 const h=harness({rejectSubscription:true});await assert.rejects(run(h),{status:422});assert.equal(h.workspace.status,'pilot');assert.equal(h.state().state,'error');assert.equal(h.state().subscription_attempted,false);
});
test('a concurrent activation receives conflict before reaching the provider',async()=>{
 const h=harness();h.admin.rpc=async()=>({data:{acquired:false}});
 await assert.rejects(run(h),{status:409});assert.equal(h.requests.length,0);
});
