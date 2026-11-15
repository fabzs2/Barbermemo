import {withMonitoring} from './_lib/monitoring.js';
import {createServiceClient} from './_lib/serviceClient.js';
import {validWebhookToken,handleBillingEvent} from './_lib/billingEvents.js';
export function createWebhookHandler(getClient=createServiceClient,processEvent=handleBillingEvent) {
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET')return res.status(process.env.ASAAS_WEBHOOK_TOKEN?200:503).json({status:process.env.ASAAS_WEBHOOK_TOKEN?'ready':'unconfigured'});
  if(req.method!=='POST')return res.status(405).json({error:'Método não permitido.'});
  if(!validWebhookToken(req.headers['asaas-access-token']))return res.status(401).json({error:'Não autorizado.'});
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch{return res.status(400).json({error:'Evento inválido.'});}}
  if(!body||typeof body!=='object'||JSON.stringify(body).length>262144)return res.status(400).json({error:'Evento inválido.'});
  const result=await processEvent(getClient(),body);
  if(result.status==='deferred')return res.status(503).json({status:'pending_link'});
  return res.status(200).json({status:result.status});
 };
}
export default withMonitoring('asaas.webhook',createWebhookHandler());
