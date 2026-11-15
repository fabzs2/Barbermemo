import {AccessError,requireSuperAdmin,unwrap} from './workspaces.js';
import {asaasFetch} from './asaas.js';
import {PLAN_PRICES} from '../../src/domain/billing.js';
export async function changeSubscription({admin,actor,workspace,body,provider=asaasFetch}) {
 requireSuperAdmin(actor);
 const action=body.action==='cancel_subscription'?'cancel':'change_plan';
 const billing=unwrap(await admin.from('barbearia_cobrancas').select('*').eq('barbearia_id',workspace.id).maybeSingle());
 if(!billing?.subscription_id||!/^sub_[A-Za-z0-9]+$/.test(billing.subscription_id))throw new AccessError('Assinatura não vinculada.',409);
 if(body.confirmChange!==true||body.expectedSubscriptionId!==billing.subscription_id)throw new AccessError('Confirme a operação para a assinatura atual.',409);
 let target=null,seats=null;
 if(action==='cancel') {
  if(body.confirmationText!=='CANCELAR')throw new AccessError('Digite CANCELAR para confirmar.');
 }else {
  target=body.plano;seats=Number(body.limiteBarbeiros);
  if(!PLAN_PRICES[target]||!Number.isInteger(seats)||seats<1||seats>100||(target==='individual'&&seats!==1))throw new AccessError('Plano ou limite inválido.');
  if(body.expectedAmountCents!==PLAN_PRICES[target])throw new AccessError('Confira o valor do novo plano.',409);
 }
 const claim=unwrap(await admin.rpc('claim_subscription_change',{p_actor:actor.id,p_workspace:workspace.id,p_action:action,p_target:target,p_seats:seats}));
 if(!claim.acquired)throw new AccessError('Uma alteração está em andamento. Aguarde e confira novamente.',409);
 const op=claim.operation;
 try {
  let current;
  try{current=await provider(`/subscriptions/${billing.subscription_id}`);}catch(e){if(e.status===404)current={id:billing.subscription_id,customer:billing.customer_id,deleted:true};else throw e;}
  if(current.id!==billing.subscription_id||current.customer!==billing.customer_id)throw new AccessError('O vínculo no Asaas diverge do cadastro.',409);
  let result;
  if(action==='cancel') {
   if(!current.deleted){const removed=await provider(`/subscriptions/${billing.subscription_id}`,{method:'DELETE'});if(removed.deleted!==true||removed.id!==billing.subscription_id)throw new Error('Cancellation response was not definitive.');}
   result={id:billing.subscription_id,customer:billing.customer_id,status:'DELETED'};
  }else {
   if(current.deleted||current.status!=='ACTIVE'||current.billingType!=='PIX'||current.cycle!=='MONTHLY')throw new AccessError('A assinatura precisa estar ativa e configurada como Pix mensal.',409);
   const wanted=PLAN_PRICES[target],actual=Math.round(Number(current.value)*100);
   if(actual!==wanted) {
    if(actual!==billing.amount_cents)throw new AccessError('O valor foi alterado fora do painel. Confira a assinatura no Asaas antes de continuar.',409);
    current=await provider(`/subscriptions/${billing.subscription_id}`,{method:'PUT',body:JSON.stringify({value:wanted/100,cycle:'MONTHLY',billingType:'PIX',description:`Barbermemo · Plano ${target==='individual'?'Individual':'Barbearia'}`,updatePendingPayments:false})});
   }
   if(current.customer!==billing.customer_id||current.status!=='ACTIVE'||Math.round(Number(current.value)*100)!==wanted)throw new Error('Plan change was not confirmed.');
   result={id:current.id,customer:current.customer,status:current.status,billingType:current.billingType,cycle:current.cycle,amount_cents:wanted};
  }
  unwrap(await admin.rpc('finish_subscription_change',{p_actor:actor.id,p_operation:op.id,p_lease:op.lease_token,p_result:result}));
  return {ok:true,canceled:action==='cancel',amountCents:target?PLAN_PRICES[target]:null};
 }catch(error) {
  const rejected=error instanceof AccessError || (error.status>=400&&error.status<500&&![408,429].includes(error.status));
  try{unwrap(await admin.rpc('fail_subscription_change',{p_actor:actor.id,p_operation:op.id,p_lease:op.lease_token,p_rejected:rejected}));}catch{console.error('billing.operation_state_update_failed');}
  if(error instanceof AccessError)throw error;
  throw new AccessError(rejected?'O Asaas recusou a alteração. Confira a assinatura e a configuração de acesso.':'Não foi possível confirmar o resultado. Use Conferir alteração; a operação será consultada antes de ser repetida.',502);
 }
}
