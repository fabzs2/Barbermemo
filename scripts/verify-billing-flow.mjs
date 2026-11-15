import {randomBytes,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createWorkspaceHandler} from '../api/workspaces.js';
import {getManagementContext} from '../api/_lib/workspaces.js';
import {connectDatabase} from './database.mjs';
import {brazilDate} from '../src/domain/billing.js';
import {handleBillingEvent} from '../api/_lib/billingEvents.js';

// Real Auth + API + PostgREST + SQL, with only the Asaas transport replaced.
// All financial POSTs remain in memory; no real customer or charge is emitted.
if(process.env.VERCEL_ENV==='production') {
 const db=await connectDatabase();
 const version='20261115_billing_lifecycle_flow_verified';
 if((await db.query('select 1 from private.schema_migrations where version=$1',[version])).rowCount){console.log('Billing flow already verified.');await db.end();}
 else {
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const anon=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,key,options);
  const suffix=`billing-qa-${randomUUID()}@example.invalid`,prefix=`Billing QA ${randomUUID()}`;
  const password='Qa1!'+randomBytes(24).toString('base64url');
  const email=who=>who+'-'+suffix;
  let stage='start',passed=false,checks=0,subscriptionPosts=0,lost=true,planPuts=0,cancelDeletes=0,lostPlan=true,lostCancel=true;
  const customers=[],subscriptions=[];
  function check(value){if(!value)throw new Error('Billing flow assertion failed.');checks++;}
  const provider=async(path,request={})=>{
   const parsed=new URL(path,'https://in-memory.invalid');
   if(parsed.pathname==='/customers'&&request.method==='POST'){const value={...JSON.parse(request.body),id:'cus_qa'+randomBytes(10).toString('hex')};customers.push(value);return value;}
   if(parsed.pathname==='/customers')return {data:customers};
   if(parsed.pathname.startsWith('/customers/'))return customers.find(c=>c.id===parsed.pathname.split('/')[2]);
   if(parsed.pathname==='/subscriptions'&&request.method==='POST'){
    subscriptionPosts++;const value={...JSON.parse(request.body),id:'sub_qa'+randomBytes(10).toString('hex'),status:'ACTIVE'};subscriptions.push(value);
    if(lost){lost=false;throw new Error('Simulated lost response; no network used.');}return value;
   }
   if(parsed.pathname==='/subscriptions')return {data:subscriptions};
   if(parsed.pathname.endsWith('/payments')){const sub=subscriptions.find(s=>s.id===parsed.pathname.split('/')[2]);return {data:[{id:'pay_qalifecycle',subscription:sub.id,customer:sub.customer,value:59.9,status:'PENDING',dueDate:brazilDate(),invoiceUrl:'https://sandbox.asaas.com/i/qa-in-memory'}]};}
   if(parsed.pathname==='/payments/pay_qalifecycle')return {id:'pay_qalifecycle',subscription:subscriptions[0].id,customer:subscriptions[0].customer,value:59.9,status:'RECEIVED',paymentDate:brazilDate(),dueDate:brazilDate()};
   if(parsed.pathname.startsWith('/subscriptions/')){
    const sub=subscriptions.find(s=>s.id===parsed.pathname.split('/')[2]);
    if(request.method==='PUT'){planPuts++;const change=JSON.parse(request.body);check(change.updatePendingPayments===false);Object.assign(sub,change);if(lostPlan){lostPlan=false;throw new Error('Simulated lost plan response.');}}
    if(request.method==='DELETE'){cancelDeletes++;sub.deleted=true;if(lostCancel){lostCancel=false;throw new Error('Simulated lost cancellation response.');}}
    return sub;
   }
   throw new Error('Unexpected in-memory provider request.');
  };
  const handler=createWorkspaceHandler(getManagementContext,provider);
  async function api(token,body,workspaceId) {
   const response={statusCode:200,setHeader(){},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};
   await handler({method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`},body,query:workspaceId?{workspaceId}:{}},response);
   return response;
  }
  async function token(who){const client=createClient(url,anon,options);const result=await client.auth.signInWithPassword({email:email(who),password});check(!result.error&&result.data.session?.access_token);return result.data.session.access_token;}
  try {
   stage='fixture auth';
   const root=await admin.auth.admin.createUser({email:email('root'),password,email_confirm:true,user_metadata:{nome:prefix}});
   check(!root.error&&root.data.user?.id);
   await db.query("update public.usuarios set role='super_admin',ativo=true where id=$1",[root.data.user.id]);
   const rootToken=await token('root');
   stage='payer provisioning';
   const created=await api(rootToken,{action:'create_workspace',workspaceName:prefix,plano:'individual',limiteBarbeiros:1,nome:'QA Payer',email:email('owner'),password,cpfCnpj:'52998224725',telefone:'11999999999'});
   check(created.statusCode===201);const workspaceId=created.body.workspaceId;
   let info=await api(rootToken,null,workspaceId);
   check(info.statusCode===200&&info.body.payer?.cpf_cnpj==='52998224725'&&!info.body.billing);
   const ownerToken=await token('owner');
   stage='authorization';
   const values={action:'activate_billing',workspaceId,cpfCnpj:'52998224725',firstDueDate:brazilDate(),confirmBilling:true,expectedPlan:'individual',expectedAmountCents:5990};
   const forbidden=await api(ownerToken,values);check(forbidden.statusCode===403&&subscriptionPosts===0);
   stage='uncertain provider response';
   const uncertain=await api(rootToken,values);check(uncertain.statusCode===502);
   info=await api(rootToken,null,workspaceId);check(info.body.selected.status==='pilot'&&info.body.billing.state==='uncertain'&&info.body.billing.subscription_attempted===true);
   stage='reconciliation';
   const activated=await api(rootToken,values);check(activated.statusCode===200&&activated.body.amountCents===5990);
   info=await api(rootToken,null,workspaceId);check(info.body.selected.status==='active'&&info.body.billing.state==='ready'&&info.body.billing.subscription_id===subscriptions[0].id);
   check(subscriptionPosts===1&&subscriptions[0].value===59.9&&subscriptions[0].billingType==='PIX'&&subscriptions[0].cycle==='MONTHLY');
   stage='reactivation without a new subscription';
   const again=await api(rootToken,values);check(again.statusCode===200&&subscriptionPosts===1);
   stage='payment reconciliation';
   check((await api(rootToken,{action:'sync_billing',workspaceId})).statusCode===200);
   const event={id:'evt_qa'+randomUUID(),event:'PAYMENT_OVERDUE',payment:{id:'pay_qalifecycle'}};
   check((await handleBillingEvent(admin,event,provider)).status==='applied');
   check((await handleBillingEvent(admin,event,provider)).status==='duplicate');
   info=await api(rootToken,null,workspaceId);check(info.body.finance.overdueCount===0&&info.body.finance.payments[0].status==='RECEIVED');
   stage='paid plan authorization';
   const plan={action:'change_subscription',workspaceId,plano:'barbearia',limiteBarbeiros:5,expectedSubscriptionId:subscriptions[0].id,confirmChange:true,expectedAmountCents:18999};
   check((await api(ownerToken,plan)).statusCode===403&&planPuts===0);
   check((await api(rootToken,{...plan,confirmChange:false})).statusCode===409&&planPuts===0);
   stage='paid plan lost response';
   check((await api(rootToken,plan)).statusCode===502);
   check((await api(rootToken,plan)).statusCode===200&&planPuts===1);
   info=await api(rootToken,null,workspaceId);check(info.body.selected.plano==='barbearia'&&info.body.billing.amount_cents===18999&&info.body.members[0].role==='dono');
   check(info.body.finance.payments[0].value_cents===5990);
   stage='cancellation lost response';
   const cancel={action:'cancel_subscription',workspaceId,expectedSubscriptionId:subscriptions[0].id,confirmChange:true,confirmationText:'CANCELAR'};
   check((await api(ownerToken,cancel)).statusCode===403&&cancelDeletes===0);
   check((await api(rootToken,cancel)).statusCode===502);
   check((await api(rootToken,cancel)).statusCode===200&&cancelDeletes===1);
   info=await api(rootToken,null,workspaceId);check(info.body.selected.status==='suspended'&&info.body.billing.state==='canceled'&&info.body.finance.payments.length===1);
   passed=true;
  }catch{console.error('Billing flow verification failed at:',stage);process.exitCode=1;}
  finally {
   const users=(await db.query('select id from auth.users where email like $1',['%-'+suffix])).rows.map(x=>x.id);
   const shops=(await db.query('select id from public.barbearias where nome=$1',[prefix])).rows.map(x=>x.id);
   await db.query('begin');
   try {
    await db.query('delete from public.billing_operations where barbearia_id=any($1::uuid[])',[shops]);
    await db.query('delete from public.barbearia_cobrancas where barbearia_id=any($1::uuid[])',[shops]);
    await db.query('update public.usuarios set ativo=false where id=any($1::uuid[])',[users]);
    await db.query('update public.barbearias set owner_id=null where id=any($1::uuid[])',[shops]);
    await db.query('delete from public.usuarios where id=any($1::uuid[])',[users]);
    await db.query('delete from public.barbearias where id=any($1::uuid[])',[shops]);
    await db.query('commit');
   }catch(e){await db.query('rollback');throw e;}
   for(const id of users){const result=await admin.auth.admin.deleteUser(id);if(result.error)throw new Error('Billing fixture cleanup failed.');}
   check(!(await db.query('select 1 from auth.users where email like $1',['%-'+suffix])).rowCount);
   if(passed){await db.query('insert into private.schema_migrations(version) values($1) on conflict do nothing',[version]);console.log(`Billing flow: ${checks} checks passed with real Auth and database; all Asaas writes simulated in memory; fixtures removed.`);}
   await db.end();
  }
 }
}
