import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifySubscriptionSchema(client) {
 const q=(sql,args)=>client.query(sql,args),one=async(sql,args)=>(await q(sql,args)).rows[0];
 let checks=0;
 const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
 async function denied(sql,args,code){await q('savepoint subscription_denied');let error;try{await q(sql,args);}catch(e){error=e;}await q('rollback to savepoint subscription_denied');eq(error?.code,code);}
 const ids={admin:randomUUID(),owner:randomUUID(),shop:randomUUID(),job:randomUUID()};
 await q('savepoint subscription_fixture');
 try {
  await q('reset role');
  for(const key of ['admin','owner'])await q("insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,'{}','{}')",[ids[key],ids[key]+'@example.invalid']);
  await q("update public.usuarios set role='super_admin',ativo=true where id=$1",[ids.admin]);
  await q("insert into public.barbearias(id,nome,owner_id,plano,status,limite_barbeiros) values($1,'Subscription QA',$2,'individual','pilot',1)",[ids.shop,ids.owner]);
  await q('update public.usuarios set ativo=true,barbearia_id=$1 where id=$2',[ids.shop,ids.owner]);
  await q("insert into public.barbearia_cobrancas(barbearia_id,plan,amount_cents,first_due_date,customer_id,subscription_id,state,subscription_status,subscription_attempted) values($1,'individual',5990,current_date,'cus_lifecycle','sub_lifecycle','ready','ACTIVE',true)",[ids.shop]);
  await q("update public.barbearias set status='active' where id=$1",[ids.shop]);
  const snapshot=async(id,status,at='2026-01-02T00:00:00Z',customer='cus_lifecycle')=>(await one("select public.apply_billing_snapshot($1,'PAYMENT_UPDATED','payment',$2,$3) as value",[id,JSON.stringify({id:'pay_lifecycle',customer,subscription:'sub_lifecycle',value_cents:5990,status,due_date:'2026-01-01'}),at])).value;
  eq((await snapshot('evt_lifecycle_1','OVERDUE')).status,'applied');
  eq((await snapshot('evt_lifecycle_1','RECEIVED')).status,'duplicate');
  eq((await snapshot('evt_lifecycle_old','PENDING','2026-01-01T00:00:00Z')).status,'stale');
  eq((await one('select public.billing_overview($1) as value',[ids.shop])).value.overdueCount,1);
  await denied("select public.apply_billing_snapshot('evt_wrong','PAYMENT_UPDATED','payment',$1,now())",[JSON.stringify({id:'pay_wrong',customer:'cus_other',subscription:'sub_lifecycle',value_cents:5990,status:'RECEIVED'})],'42501');
  await snapshot('evt_lifecycle_paid','RECEIVED','2026-01-03T00:00:00Z');
  eq((await one('select public.billing_overview($1) as value',[ids.shop])).value.overdueCount,0);
  await denied("select public.claim_subscription_change($1,$2,'cancel',null,null)",[ids.owner,ids.shop],'42501');
  const claim=async(action,target=null,seats=null)=>(await one('select public.claim_subscription_change($1,$2,$3,$4,$5) as value',[ids.admin,ids.shop,action,target,seats])).value;
  const change=await claim('change_plan','barbearia',5);eq(change.acquired,true);
  eq((await claim('change_plan','barbearia',5)).acquired,false);
  await denied('select public.reserve_workspace_account($1,$2,$3)',[ids.admin,ids.shop,'barbeiro'],'23514');
  await denied('select public.finish_subscription_change($1,$2,$3,$4)',[ids.admin,change.operation.id,randomUUID(),JSON.stringify({})],'42501');
  await q('select public.finish_subscription_change($1,$2,$3,$4)',[ids.admin,change.operation.id,change.operation.lease_token,JSON.stringify({id:'sub_lifecycle',customer:'cus_lifecycle',status:'ACTIVE',billingType:'PIX',cycle:'MONTHLY',amount_cents:18999})]);
  eq((await one('select plano,limite_barbeiros from public.barbearias where id=$1',[ids.shop])),{plano:'barbearia',limite_barbeiros:5});
  eq((await one('select role from public.usuarios where id=$1',[ids.owner])).role,'dono');
  const cancel=await claim('cancel');eq(cancel.acquired,true);
  await q('select public.fail_subscription_change($1,$2,$3,false)',[ids.admin,cancel.operation.id,cancel.operation.lease_token]);
  const retry=await claim('cancel');eq(retry.operation.id,cancel.operation.id);
  await q('select public.finish_subscription_change($1,$2,$3,$4)',[ids.admin,retry.operation.id,retry.operation.lease_token,JSON.stringify({id:'sub_lifecycle',customer:'cus_lifecycle',status:'DELETED'})]);
  eq((await one('select status from public.barbearias where id=$1',[ids.shop])).status,'suspended');
  eq((await one('select state from public.barbearia_cobrancas where barbearia_id=$1',[ids.shop])).state,'canceled');
  await q('select public.reset_canceled_billing($1,$2,current_date)',[ids.admin,ids.shop]);
  eq((await one('select subscription_id from public.barbearia_cobrancas where barbearia_id=$1',[ids.shop])).subscription_id,null);
  eq((await one("select count(*)::int as value from public.billing_subscription_links where subscription_id='sub_lifecycle'")).value,1);
  eq((await one("select count(*)::int as value from public.billing_payments where id='pay_lifecycle'")).value,1);
  eq((await one("select public.claim_ops_job('backup',$1,60) as value",[ids.job])).value,true);
  eq((await one("select public.claim_ops_job('backup',$1,60) as value",[randomUUID()])).value,false);
  await q("select public.release_ops_job('backup',$1)",[ids.job]);
  await q("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.owner,role:'authenticated'})]);
  await q('set local role authenticated');
  eq((await one('select count(*)::int as value from public.billing_payments where barbearia_id=$1',[ids.shop])).value,0);
  await denied("select public.claim_subscription_change($1,$2,'cancel',null,null)",[ids.admin,ids.shop],'42501');
  await denied("insert into public.service_status(key,success) values('forged',true)",[],'42501');
  await q('reset role');await q('set local role anon');
  await denied('select * from public.billing_payments',[],'42501');
  console.log(`Subscription lifecycle: ${checks} checks passed; payment ordering, cancellation, plan changes, locks and RLS verified without real billing writes.`);
 }finally{await q('rollback to savepoint subscription_fixture');await q('release savepoint subscription_fixture');}
}
