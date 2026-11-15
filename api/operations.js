import {timingSafeEqual} from 'node:crypto';
import {getManagementContext,requireSuperAdmin,AccessError} from './_lib/workspaces.js';
import {createServiceClient} from './_lib/serviceClient.js';
import {withMonitoring} from './_lib/monitoring.js';
import {setupBillingWebhook,sendRecoveryDeliveryTest,verifyRecoveryDelivery} from './_lib/operations.js';
import {runBackup} from './_lib/backups.js';
export function validOperationsToken(received,expected=process.env.CRON_SECRET) {
 if(typeof received!=='string'||!expected||expected.length<32)return false;
 const a=Buffer.from(received),b=Buffer.from('Bearer '+expected);return a.length===b.length&&timingSafeEqual(a,b);
}
export function createOperationsHandler(dependencies={}) {
 const context=dependencies.context||getManagementContext,backup=dependencies.backup||runBackup,setup=dependencies.setup||setupBillingWebhook,client=dependencies.client||createServiceClient;
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método não permitido.'});
  let admin;
  try {
   if(validOperationsToken(req.headers.authorization))admin=client();else{const ctx=await context(req);requireSuperAdmin(ctx.actor);admin=ctx.admin;}
   const action=req.method==='GET'?'backup':req.body?.action;
   if(action==='backup'||action==='restore_check')return res.status(200).json(await backup({verifyRestore:action==='restore_check',admin}));
   if(action==='setup_webhook')return res.status(200).json(await setup(admin));
   if(action==='send_recovery_test')return res.status(200).json(await sendRecoveryDeliveryTest(admin));
   if(action==='verify_smtp_delivery')return res.status(200).json(await verifyRecoveryDelivery(admin));
   return res.status(400).json({error:'Operação desconhecida.'});
  }catch(error){if(error instanceof AccessError)return res.status(error.status).json({error:error.message});throw error;}
 };
}
export default withMonitoring('operations.maintenance',createOperationsHandler());
