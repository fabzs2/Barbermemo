import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifyBillingSchema(client) {
 await client.query('savepoint billing_fixture');
 const ids={admin:randomUUID(),owner:randomUUID(),shop:randomUUID()};
 let checks=0;
 const q=(sql,params)=>client.query(sql,params);
 const one=async(sql,params)=>(await q(sql,params)).rows[0];
 async function as(role,id){await q('reset role');await q("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role,...(id?{sub:id}:{})})]);await q(`set local role ${role}`);}
 async function denied(sql,params,code){await q('savepoint billing_denial');let caught;try{await q(sql,params);}catch(e){caught=e;}await q('rollback to savepoint billing_denial');assert.equal(caught?.code,code);checks++;}
 try {
  await as('service_role');await q('reset role');
  for(const [key,name] of [['admin','QA Billing admin'],['owner','QA Billing owner']])await q("insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,'{}')",[ids[key],ids[key]+'@example.invalid',JSON.stringify({nome:name})]);
  await q("update public.usuarios set role='super_admin',ativo=true where id=$1",[ids.admin]);
  await q("insert into public.barbearias(id,nome,owner_id,plano,status,limite_barbeiros) values($1,'QA billing shop',$2,'individual','pilot',1)",[ids.shop,ids.owner]);
  await q("update public.usuarios set ativo=true,barbearia_id=$1 where id=$2",[ids.shop,ids.owner]);
  await as('service_role');
  await denied("select public.begin_workspace_billing($1,$2,'individual',5990,current_date)",[ids.owner,ids.shop],'42501');
  await denied("update public.barbearias set status='active' where id=$1",[ids.shop],'42501');
  await denied("select public.begin_workspace_billing($1,$2,'individual',1,current_date)",[ids.admin,ids.shop],'23514');
  const claim=(await one("select public.begin_workspace_billing($1,$2,'individual',5990,(now() at time zone 'America/Sao_Paulo')::date) as value",[ids.admin,ids.shop])).value;
  assert.equal(claim.acquired,true);checks++;
  const duplicate=(await one("select public.begin_workspace_billing($1,$2,'individual',5990,current_date) as value",[ids.admin,ids.shop])).value;
  assert.equal(duplicate.acquired,false);checks++;
  await denied("update public.barbearias set status='suspended' where id=$1",[ids.shop],'23514');
  const progress=(action,values={})=>q('select public.progress_workspace_billing($1,$2,$3,$4,$5)',[ids.admin,ids.shop,claim.lease,action,JSON.stringify(values)]);
  await progress('customer_attempt');
  await progress('customer_saved',{customer_id:'cus_fixture'});
  await progress('subscription_attempt');
  await progress('uncertain',{stage:'subscription_post'});
  const retry=(await one("select public.begin_workspace_billing($1,$2,'individual',5990,current_date) as value",[ids.admin,ids.shop])).value;
  assert.equal(retry.billing.subscription_attempted,true);checks++;
  await denied('select public.progress_workspace_billing($1,$2,$3,$4,$5)',[ids.admin,ids.shop,claim.lease,'complete',JSON.stringify({customer_id:'cus_fixture',subscription_id:'sub_fixture'})],'42501');
  await q('select public.progress_workspace_billing($1,$2,$3,$4,$5)',[ids.admin,ids.shop,retry.lease,'complete',JSON.stringify({customer_id:'cus_fixture',subscription_id:'sub_fixture'})]);
  assert.equal((await one('select status from public.barbearias where id=$1',[ids.shop])).status,'active');checks++;
  assert.equal((await one('select subscription_id from public.usuarios where id=$1',[ids.owner])).subscription_id,'sub_fixture');checks++;
  await denied("update public.barbearias set plano='barbearia',limite_barbeiros=5 where id=$1",[ids.shop],'23514');
  await as('authenticated',ids.owner);
  assert.equal((await one('select count(*)::int as value from public.barbearia_cobrancas where barbearia_id=$1',[ids.shop])).value,0);checks++;
  await denied("update public.usuarios set cpf_cnpj='forged' where id=$1",[ids.owner],'42501');
  await denied("select public.begin_workspace_billing($1,$2,'individual',5990,current_date)",[ids.admin,ids.shop],'42501');
  await as('anon');await denied('select * from public.barbearia_cobrancas',[],'42501');
  console.log(`Billing isolation: ${checks} checks passed; no Asaas charges created.`);
 }finally{await q('rollback to savepoint billing_fixture');await q('release savepoint billing_fixture');}
}
