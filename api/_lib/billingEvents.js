import {asaasFetch} from './asaas.js';
import {unwrap} from './workspaces.js';
import {safeInvoiceUrl} from './billing.js';
import {randomUUID,timingSafeEqual} from 'node:crypto';
export const BILLING_EVENTS=['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','PAYMENT_DELETED','PAYMENT_RESTORED','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_RECEIVED_IN_CASH_UNDONE','PAYMENT_CHARGEBACK_REQUESTED','SUBSCRIPTION_CREATED','SUBSCRIPTION_UPDATED','SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED'];
export function validWebhookToken(received,expected=process.env.ASAAS_WEBHOOK_TOKEN) {
 if(typeof received!=='string'||!expected||expected.length<32)return false;
 const a=Buffer.from(received),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
const validId=(value,prefix)=>new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value||'');
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}/.test(value)?value.slice(0,10):null;
const status=value=>typeof value==='string'&&/^[A-Z_]{1,60}$/.test(value)?value:'UNKNOWN';
export function normalizeBillingResource(kind,value) {
 if(kind==='subscription')return {id:value.id,customer:value.customer,status:value.deleted?'DELETED':status(value.status)};
 const cents=Math.round(Number(value.value)*100);
 if(!Number.isSafeInteger(cents)||cents<0||cents>2147483647)throw new Error('Invalid provider amount.');
 return {id:value.id,customer:value.customer,subscription:value.subscription,status:value.deleted?'DELETED':status(value.status),value_cents:cents,due_date:date(value.dueDate),payment_date:date(value.paymentDate||value.clientPaymentDate),invoice_url:safeInvoiceUrl(value.invoiceUrl)};
}
export async function persistBillingResource(admin,kind,value,eventId,eventType,observedAt) {
 return unwrap(await admin.rpc('apply_billing_snapshot',{p_event_id:eventId,p_event_type:eventType,p_kind:kind,p_data:normalizeBillingResource(kind,value),p_observed:observedAt}));
}
export async function handleBillingEvent(admin,event,provider=asaasFetch) {
 if(!BILLING_EVENTS.includes(event.event))return {status:'ignored'};
 if(typeof event.id!=='string'||!/^[A-Za-z0-9_-]{1,180}$/.test(event.id))throw new Error('Invalid webhook event.');
 const kind=event.event.startsWith('PAYMENT_')?'payment':'subscription';
 const original=event[kind];
 if(!validId(original?.id,kind==='payment'?'pay':'sub'))throw new Error('Invalid webhook resource.');
 const observedAt=new Date().toISOString();
 let resource;
 try {resource=await provider(`/${kind==='payment'?'payments':'subscriptions'}/${original.id}`);}
 catch(error) {
  if(error.status===404&&event.event.endsWith('_DELETED'))resource={...original,deleted:true};else throw error;
 }
 const sub=kind==='payment'?resource.subscription:resource.id;
 if(!validId(sub,'sub'))return {status:'ignored'};
 const link=unwrap(await admin.from('billing_subscription_links').select('subscription_id').eq('subscription_id',sub).maybeSingle());
 if(!link) {
  const subscription=kind==='subscription'?resource:await provider(`/subscriptions/${sub}`);
  const ref=String(subscription.externalReference||'');
  const workspaceId=ref.startsWith('barbermemo:')?ref.slice(11):'';
  if(/^[0-9a-f-]{36}$/i.test(workspaceId)) {
   const pending=unwrap(await admin.from('barbearia_cobrancas').select('customer_id').eq('barbearia_id',workspaceId).maybeSingle());
   if(pending?.customer_id===subscription.customer)return {status:'deferred'};
  }
  return {status:'ignored'};
 }
 return persistBillingResource(admin,kind,resource,event.id,event.event,observedAt);
}
export async function syncWorkspaceBilling(admin,billing,provider=asaasFetch) {
 if(!validId(billing.subscription_id,'sub'))throw new Error('Invalid linked subscription.');
 const observed=new Date().toISOString();
 let subscription;
 try{subscription=await provider(`/subscriptions/${billing.subscription_id}`);}catch(error){if(error.status!==404)throw error;subscription={id:billing.subscription_id,customer:billing.customer_id,deleted:true};}
 await persistBillingResource(admin,'subscription',subscription,'sync_'+randomUUID(),'MANUAL_SYNC',observed);
 let offset=0,count=0;
 while(true) {
  const at=new Date().toISOString();
  const page=await provider(`/subscriptions/${billing.subscription_id}/payments?limit=100&offset=${offset}`);
  for(const payment of page.data||[]) {
   if(payment.subscription!==billing.subscription_id||payment.customer!==billing.customer_id)throw new Error('Provider billing association mismatch.');
   await persistBillingResource(admin,'payment',payment,'sync_'+randomUUID(),'MANUAL_SYNC',at);count++;
  }
  if(!page.hasMore)break;
  offset+=100;if(offset>=10000)throw new Error('Billing reconciliation exceeded safe batch size.');
 }
 return {ok:true,payments:count};
}
