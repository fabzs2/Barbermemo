import {put,get,list,del} from '@vercel/blob';
import {randomUUID} from 'node:crypto';
import {connectDatabase} from '../../scripts/database.mjs';
import {collectDatabaseSnapshot,sha256} from './backupSnapshot.js';
import {encryptBackup,decryptBackup} from './backupCrypto.js';
import {createServiceClient} from './serviceClient.js';
import {unwrap} from './workspaces.js';
const PREFIX='barbermemo-backups/v1/';
async function readPrivate(path) {
 const response=await get(path,{access:'private',useCache:false});if(!response||response.statusCode!==200)throw new Error('Private backup could not be read.');
 return Buffer.from(await new Response(response.stream).arrayBuffer());
}
export async function runBackup({verifyRestore=false,admin=createServiceClient()}={}) {
 const job=randomUUID();
 if(!unwrap(await admin.rpc('claim_ops_job',{p_key:'backup',p_token:job,p_seconds:900})))throw new Error('Another backup is running.');
 let client,snapshot;
 try {
  client=await connectDatabase();if(!client)throw new Error('Database not configured for backup.');
  snapshot=await collectDatabaseSnapshot(client);
  const metadata=snapshot.storageObjects;
  const buckets=await admin.storage.getBucket('barbermemo-photos');if(buckets.error)throw buckets.error;
  snapshot.buckets=[{id:buckets.data.id,name:buckets.data.name,public:false,fileSizeLimit:buckets.data.file_size_limit,allowedMimeTypes:buckets.data.allowed_mime_types}];
  snapshot.photos=[];let total=0;
  for(const object of metadata) {
   const download=await admin.storage.from(object.bucket_id).download(object.name);if(download.error)throw download.error;
   const data=Buffer.from(await download.data.arrayBuffer());total+=data.length;if(total>40*1024*1024)throw new Error('Photo backup exceeds safe size; increase backup capacity before growth.');
   snapshot.photos.push({bucket:object.bucket_id,name:object.name,contentType:download.data.type,sha256:sha256(data),size:data.length,data:data.toString('base64')});
  }
  const encrypted=encryptBackup(snapshot),hash=sha256(encrypted),pathname=PREFIX+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID()+'.bmbk';
  await put(pathname,encrypted,{access:'private',contentType:'application/octet-stream',addRandomSuffix:false});
  const saved=await readPrivate(pathname);if(sha256(saved)!==hash)throw new Error('Uploaded backup failed integrity check.');
  const restored=decryptBackup(saved);
  const previous=unwrap(await admin.from('service_status').select('checked_at').eq('key','restore_check').eq('success',true).maybeSingle());
  const needsRestore=verifyRestore||!previous||Date.now()-Date.parse(previous.checked_at)>7*86400000;
  let restore=null;
  if(needsRestore) {
   const {verifyDatabaseRestore,verifyPhotoRestore}=await import('./restoreCheck.js');
   restore={...await verifyDatabaseRestore(restored),...await verifyPhotoRestore(restored,admin)};
   unwrap(await admin.from('service_status').upsert({key:'restore_check',success:true,checked_at:new Date().toISOString(),details:restore}));
  }
  const details={pathname,sha256:hash,bytes:encrypted.length,tables:snapshot.tables.length,rows:snapshot.tables.reduce((sum,t)=>sum+t.rows.length,0),photos:snapshot.photos.length};
  unwrap(await admin.from('service_status').upsert({key:'backup',success:true,checked_at:new Date().toISOString(),details}));
  // Remove only this application's old copies, after the new encrypted copy is validated.
  let cursor;const existing=[];
  do{const page=await list({prefix:PREFIX,limit:1000,...(cursor?{cursor}:{})});existing.push(...page.blobs);cursor=page.hasMore?page.cursor:null;}while(cursor);
  const old=existing.sort((a,b)=>new Date(b.uploadedAt)-new Date(a.uploadedAt)).slice(14).filter(x=>x.pathname.startsWith(PREFIX)&&x.pathname!==pathname);
  if(old.length)await del(old.map(x=>x.url));
  return {...details,restore};
 }catch(error){await admin.from('service_status').upsert({key:'backup_attempt',success:false,checked_at:new Date().toISOString(),details:{code:'backup_failed'}}).catch(()=>{});throw error;}
 finally{if(client)await client.end();await admin.rpc('release_ops_job',{p_key:'backup',p_token:job});}
}
