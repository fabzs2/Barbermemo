import {asaasFetch} from './asaas.js';
import {BILLING_EVENTS} from './billingEvents.js';
import {unwrap} from './workspaces.js';
export async function verifyRecoveryDelivery(admin) {
 const response=await fetch('https://api.resend.com/emails?limit=100',{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`}});
 if(!response.ok)throw new Error('Email delivery verification failed.');
 const result=await response.json();
 const delivery=result.data?.find(email=>email.to?.includes('fmarangonic@gmail.com')&&email.from?.includes('acesso@barbermemo.com.br')&&email.last_event==='delivered');
 if(!delivery)throw new Error('Recovery email delivery has not been confirmed.');
 unwrap(await admin.from('service_status').upsert({key:'smtp_delivery',success:true,checked_at:new Date().toISOString(),details:{id:delivery.id,event:'delivered',deliveredMessageCreatedAt:delivery.created_at}}));
 return {ok:true,event:'delivered'};
}
export async function setupBillingWebhook(admin,provider=asaasFetch) {
 const authToken=process.env.ASAAS_WEBHOOK_TOKEN;if(!authToken||authToken.length<32)throw new Error('Webhook authentication missing.');
 const url='https://www.barbermemo.com.br/api/asaas-webhook';
 const response=await provider('/webhooks?limit=100');
 const ours=(response.data||[]).filter(x=>x.url===url);
 if(ours.length>1)throw new Error('Duplicate application webhooks require review.');
 const payload={name:'Barbermemo — Pagamentos',url,email:'fmarangonic@gmail.com',enabled:true,interrupted:false,sendType:'SEQUENTIALLY',authToken,events:BILLING_EVENTS};
 const result=await provider(ours.length?`/webhooks/${ours[0].id}`:'/webhooks',{method:ours.length?'PUT':'POST',body:JSON.stringify(payload)});
 if(result.enabled!==true||result.url!==url)throw new Error('Webhook registration was not confirmed.');
 unwrap(await admin.from('service_status').upsert({key:'asaas_webhook',success:true,checked_at:new Date().toISOString(),details:{id:result.id,events:BILLING_EVENTS.length}}));
 return {ok:true,id:result.id};
}
export async function sendRecoveryDeliveryTest(admin) {
 // Explicitly authorized recipient; never send test recovery messages to customers.
 const result=await admin.auth.resetPasswordForEmail('fmarangonic@gmail.com',{redirectTo:'https://www.barbermemo.com.br/redefinir-senha'});
 if(result.error)throw new Error('Auth recovery delivery request failed.');
 unwrap(await admin.from('service_status').upsert({key:'smtp_test_requested',success:true,checked_at:new Date().toISOString(),details:{awaitingDeliveryConfirmation:true}}));
 return {ok:true,awaitingDeliveryConfirmation:true};
}
