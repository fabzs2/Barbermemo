import {restorationSql,restoreRows,tableName,quoteIdent,sha256} from './backupSnapshot.js';
import {randomBytes} from 'node:crypto';
export async function verifyDatabaseRestore(snapshot) {
 const {PGlite}=await import('@electric-sql/pglite');
 const database=new PGlite();
 try {
  const sql=restorationSql(snapshot);
  await database.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;"+sql.schemas+"grant usage on schema public,auth,storage to anon,authenticated,service_role;");
  for(const statement of snapshot.enums)await database.exec(statement);
  for(const table of snapshot.tables.filter(t=>t.schema==='auth'))await database.exec(table.definition);
  for(const definition of snapshot.authSupport)await database.exec(definition);
  await database.exec("create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant all on storage.objects to service_role;grant select,insert,update,delete on storage.objects to authenticated;");
  await database.exec(sql.structure);
  await database.exec("set timezone='UTC'");
  await restoreRows(database,snapshot);
  for(const c of snapshot.constraints.filter(c=>c.schema==='auth'))await database.exec(`alter table ${tableName(c.schema,c.name)} add constraint ${quoteIdent(c.conname)} ${c.definition};`);
  await database.exec(sql.functions);
  await database.exec(sql.constraints);
  await database.exec(sql.finish);
  let rows=0;
  for(const table of snapshot.tables) {
   const actual=(await database.query(`select to_jsonb(t)::text as row from ${tableName(table.schema,table.name)} t`)).rows.map(x=>x.row).sort();
   if(actual.length!==table.rows.length||sha256(actual.join('\n'))!==table.hash)throw new Error('Restored data does not match backup.');rows+=actual.length;
  }
  // A restored database must preserve access restrictions, not just row counts.
  await database.exec('begin;set local role anon');let denied=false;
  try{await database.query('select * from public.clientes limit 1');}catch{denied=true;}
  await database.exec('rollback');if(!denied)throw new Error('Restoration did not preserve anonymous access restrictions.');
  return {tables:snapshot.tables.length,rows};
 }finally{await database.close();}
}
// These private buckets are reserved exclusively for this application's restore tests.
export async function cleanupRestoreBuckets(admin) {
 const listed=await admin.storage.listBuckets();if(listed.error)throw listed.error;
 for(const bucket of listed.data.filter(b=>/^barbermemo-restore-[a-f0-9]{20}$/.test(b.id)&&b.public===false)) {
  const objects=await admin.storage.from(bucket.id).list('',{limit:1});if(objects.error)throw objects.error;
  // Never empty an unknown bucket; clean up only an already empty test bucket.
  if(objects.data.length===0){const removed=await admin.storage.deleteBucket(bucket.id);if(removed.error)throw removed.error;}
 }
}
export async function verifyPhotoRestore(snapshot,admin) {
 await cleanupRestoreBuckets(admin);
 const bucket='barbermemo-restore-'+randomBytes(10).toString('hex');let created=false,failure=null,phase='create';const names=[];
 try {
  const result=await admin.storage.createBucket(bucket,{public:false});if(result.error)throw result.error;created=true;
  for(let i=0;i<snapshot.photos.length;i++) {
   const photo=snapshot.photos[i],body=Buffer.from(photo.data,'base64');
   if(sha256(body)!==photo.sha256)throw new Error('Photo hash mismatch in backup.');
   const name='restored/'+i;names.push(name);phase='upload';
   const upload=await admin.storage.from(bucket).upload(name,body,{contentType:photo.contentType||'application/octet-stream'});if(upload.error)throw upload.error;
   phase='download';const download=await admin.storage.from(bucket).download(name);if(download.error)throw download.error;
   phase='compare';if(sha256(Buffer.from(await download.data.arrayBuffer()))!==photo.sha256)throw new Error('Restored photo differs from backup.');
  }
 }catch(error){failure=error;failure.code='photo_'+phase;}
 if(created){
  try {
   // remove() is synchronous for these few known objects; emptyBucket() can queue a job.
   if(names.length){phase='cleanup_objects';const removed=await admin.storage.from(bucket).remove(names);if(removed.error)throw removed.error;}
   phase='cleanup_bucket';const removed=await admin.storage.deleteBucket(bucket);if(removed.error)throw removed.error;
  }catch(error){if(!failure){failure=error;failure.code='photo_'+phase;}}
 }
 if(failure)throw failure;
 return {photos:snapshot.photos.length};
}
