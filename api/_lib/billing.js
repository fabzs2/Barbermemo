import { asaasFetch } from './asaas.js';
import { AccessError, requireSuperAdmin, unwrap } from './workspaces.js';
import { PLAN_PRICES, cleanDocument, validDocument } from '../../src/domain/billing.js';

export function payerInput(body, required = false) {
  const cpfCnpj = cleanDocument(body.cpfCnpj);
  const telefone = String(body.telefone || '').replace(/\D/g, '');
  if ((required || cpfCnpj) && !validDocument(cpfCnpj)) throw new AccessError('Informe um CPF ou CNPJ válido do titular.');
  if (telefone && !/^\d{10,11}$/.test(telefone)) throw new AccessError('Informe o telefone com DDD.');
  return {cpfCnpj,telefone};
}
export function safeInvoiceUrl(value) {
  try { const url=new URL(value); return url.protocol==='https:' && (url.hostname==='asaas.com'||url.hostname.endsWith('.asaas.com')) ? url.href : null; }
  catch { return null; }
}
const reference = id => `barbermemo:${id}`;
function checkId(value, prefix) {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value||'')) throw new Error('Unexpected billing resource identifier.');
  return value;
}
export async function invoiceForSubscription(provider, subscriptionId) {
  checkId(subscriptionId,'sub');
  const result=await provider(`/subscriptions/${subscriptionId}/payments?limit=100`);
  const payments=(result.data||[]).filter(p=>!p.deleted && ['PENDING','OVERDUE'].includes(p.status)).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));
  return safeInvoiceUrl(payments[0]?.invoiceUrl);
}
export async function activateWorkspaceBilling({admin,actor,workspace,body,provider=asaasFetch}) {
  requireSuperAdmin(actor);
  const cents=PLAN_PRICES[workspace.plano];
  if(body.confirmBilling!==true)throw new AccessError('Confirme a assinatura mensal antes de ativar.');
  if(body.expectedPlan!==workspace.plano || body.expectedAmountCents!==cents)throw new AccessError('O plano mudou. Atualize a tela e confira o valor antes de confirmar.',409);
  const payer=unwrap(await admin.from('usuarios').select('id,nome,email,cpf_cnpj,telefone,ativo').eq('id',workspace.owner_id).eq('barbearia_id',workspace.id).maybeSingle());
  if(!payer?.ativo)throw new AccessError('O titular precisa estar com o cadastro liberado.',409);
  const input=payerInput({cpfCnpj:body.cpfCnpj||payer.cpf_cnpj,telefone:body.telefone??payer.telefone},true);
  const due=String(body.firstDueDate||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due+'T12:00:00Z'))||new Date(due+'T12:00:00Z').toISOString().slice(0,10)!==due)throw new AccessError('Informe o primeiro vencimento.');
  if(body.restartCanceled===true) {
    const old=unwrap(await admin.from('barbearia_cobrancas').select('subscription_id,subscription_status').eq('barbearia_id',workspace.id).maybeSingle());
    if(old?.subscription_status!=='DELETED'||!/^sub_[A-Za-z0-9]+$/.test(old.subscription_id||''))throw new AccessError('Confirme o cancelamento anterior antes de criar outra assinatura.',409);
    try{const previous=await provider(`/subscriptions/${old.subscription_id}`);if(!previous.deleted)throw new AccessError('A assinatura anterior ainda existe no Asaas.',409);}catch(error){if(error.status!==404)throw error;}
    unwrap(await admin.rpc('reset_canceled_billing',{p_actor:actor.id,p_workspace:workspace.id,p_due:due}));
  }
  const claim=unwrap(await admin.rpc('begin_workspace_billing',{p_actor:actor.id,p_workspace:workspace.id,p_plan:workspace.plano,p_amount:cents,p_due:due}));
  if(!claim.acquired)throw new AccessError('Uma ativação está em andamento. Aguarde e confira novamente.',409);
  let billing=claim.billing;
  const lease=claim.lease;
  let stage='read';
  async function progress(action,values={}) {
    billing=unwrap(await admin.rpc('progress_workspace_billing',{p_actor:actor.id,p_workspace:workspace.id,p_lease:lease,p_action:action,p_values:values}));
    return billing;
  }
  try {
    unwrap(await admin.from('usuarios').update({cpf_cnpj:input.cpfCnpj,telefone:input.telefone||payer.telefone}).eq('id',payer.id));
    const payload={name:payer.nome,cpfCnpj:input.cpfCnpj,email:payer.email,mobilePhone:input.telefone||undefined,externalReference:payer.id};
    let customer;
    if(billing.customer_id) {
      checkId(billing.customer_id,'cus');
      customer=await provider(`/customers/${billing.customer_id}`);
      if(customer.deleted || (customer.externalReference && customer.externalReference!==payer.id))throw new AccessError('Confira o vínculo do titular no Asaas antes de ativar.',409);
    } else {
      const found=await provider(`/customers?externalReference=${encodeURIComponent(payer.id)}&limit=100`);
      const matches=(found.data||[]).filter(c=>!c.deleted && c.externalReference===payer.id);
      if(matches.length>1)throw new AccessError('Há mais de um cliente vinculado no Asaas. Revise o cadastro antes de ativar.',409);
      customer=matches[0];
      if(!customer) {
        if(billing.customer_attempted)throw new AccessError('A criação do cliente ainda precisa ser conferida no Asaas. Nenhum novo cadastro será repetido automaticamente.',409);
        await progress('customer_attempt');stage='customer_post';
        customer=await provider('/customers',{method:'POST',body:JSON.stringify(payload)});
        checkId(customer.id,'cus');
        stage='read';
      }
    }
    checkId(customer.id,'cus');
    await progress('customer_saved',{customer_id:customer.id});
    await provider(`/customers/${customer.id}`,{method:'PUT',body:JSON.stringify(payload)});
    let subscription;
    if(billing.subscription_id) {
      checkId(billing.subscription_id,'sub');
      subscription=await provider(`/subscriptions/${billing.subscription_id}`);
    } else {
      const found=await provider(`/subscriptions?customer=${customer.id}&externalReference=${encodeURIComponent(reference(workspace.id))}&limit=100`);
      const matches=(found.data||[]).filter(s=>s.externalReference===reference(workspace.id) && s.customer===customer.id && !s.deleted);
      if(matches.length>1)throw new AccessError('Há assinaturas duplicadas no Asaas. Revise antes de ativar.',409);
      subscription=matches[0];
      if(!subscription) {
        if(billing.subscription_attempted)throw new AccessError('A assinatura pode ter sido criada, mas a resposta não foi confirmada. Use Conferir ativação para consultar o Asaas sem duplicar a cobrança.',409);
        const existing=await provider(`/subscriptions?customer=${customer.id}&status=ACTIVE&limit=1`);
        if(existing.data?.length)throw new AccessError('Este titular já tem uma assinatura no Asaas. Vincule ou revise a assinatura existente antes de criar outra.',409);
        await progress('subscription_attempt');stage='subscription_post';
        subscription=await provider('/subscriptions',{method:'POST',body:JSON.stringify({customer:customer.id,billingType:'PIX',value:cents/100,nextDueDate:billing.first_due_date,cycle:'MONTHLY',description:`Barbermemo · Plano ${workspace.plano==='individual'?'Individual':'Barbearia'}`,externalReference:reference(workspace.id)})});
        checkId(subscription.id,'sub');stage='read';
      }
    }
    checkId(subscription.id,'sub');
    if(subscription.deleted || subscription.status!=='ACTIVE' || subscription.customer!==customer.id || subscription.billingType!=='PIX' || subscription.cycle!=='MONTHLY' || Math.round(Number(subscription.value)*100)!==cents) {
      throw new AccessError('A assinatura existente diverge do plano mensal por Pix. Confira os dados no Asaas antes de ativar.',409);
    }
    await progress('complete',{subscription_id:subscription.id,customer_id:customer.id});
    let invoiceUrl=null;
    try { invoiceUrl=await invoiceForSubscription(provider,subscription.id); if(invoiceUrl)await progress('invoice',{invoice_url:invoiceUrl}); }
    catch { console.warn('billing.invoice_link_pending'); }
    return {ok:true,subscriptionId:subscription.id,invoiceUrl,amountCents:cents};
  } catch(error) {
    // Only a definitive validation rejection allows another POST. Network errors,
    // timeouts and 5xx preserve the attempted markers and require reconciliation.
    const definitive=error.status>=400 && error.status<500 && ![408,409,429].includes(error.status) && !(error instanceof AccessError);
    try { await progress(definitive?'rejected':'uncertain',{stage}); } catch { console.error('billing.failure_state_update_failed'); }
    if(error instanceof AccessError)throw error;
    if([401,403].includes(error.status))throw new AccessError('O Asaas recusou a configuração de acesso. Confira a chave de API de produção na Vercel.',502);
    if(error.status===404)throw new AccessError('O cadastro ou a assinatura vinculada não foi encontrado no Asaas. Revise o vínculo antes de ativar.',409);
    if(definitive)throw new AccessError('O Asaas recusou os dados. Confira CPF/CNPJ, telefone e vencimento e tente novamente.',422);
    throw new AccessError('Não foi possível confirmar a ativação no Asaas. Use Conferir ativação antes de tentar criar outra cobrança.',502);
  }
}
