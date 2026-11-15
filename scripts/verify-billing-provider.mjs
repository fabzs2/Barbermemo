import {asaasFetch,asaasEnvironment} from '../api/_lib/asaas.js';
if(process.env.VERCEL_ENV==='production') {
 const environment=asaasEnvironment();
 console.log('Asaas billing environment:',environment);
 if(environment==='unconfigured')throw new Error('Configure Asaas server credentials before enabling paid activation.');
 // Read-only: verifies the configured credential without creating customers,
 // subscriptions or payments. Never prints records or secrets.
 const result=await asaasFetch('/subscriptions?limit=1');
 if(!Array.isArray(result.data))throw new Error('Asaas authenticated read failed.');
 console.log('Asaas authenticated read verified; no billing operation executed.');
}
