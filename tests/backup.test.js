import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {collectDatabaseSnapshot} from '../api/_lib/backupSnapshot.js';
import {encryptBackup,decryptBackup} from '../api/_lib/backupCrypto.js';
import {verifyDatabaseRestore} from '../api/_lib/restoreCheck.js';
const key='ab'.repeat(32);

test('backup encryption authenticates contents and rejects corruption or a wrong key',()=>{
 const original={format:'barbermemo-application-backup-v1',tables:[],photos:[{data:'sensitive example'}]};
 const encrypted=encryptBackup(original,key);assert.equal(encrypted.includes(Buffer.from('sensitive example')),false);
 assert.deepEqual(decryptBackup(encrypted,key),original);
 assert.throws(()=>decryptBackup(encrypted,'cd'.repeat(32)));
 const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;assert.throws(()=>decryptBackup(damaged,key));
});

test('logical backup restores rows, schema, generated columns, exact bigint values and access restrictions',async()=>{
 const source=new PGlite();
 const client={query:async(sql,args)=>args?source.query(sql,args):(await source.exec(sql)).at(-1)||{rows:[]}};
 try {
  await source.exec(await readFile(new URL('./fixtures-legacy.sql',import.meta.url),'utf8'));
  for(const version of ['20261115_workspaces','20261115194802_workspace_billing','20261115202455_billing_events_and_subscription_management'])await source.exec(await readFile(new URL(`../supabase/migrations/${version}.sql`,import.meta.url),'utf8'));
  await source.exec("create type public.snapshot_probe_type as enum ('one','two');create table public.snapshot_probe(id bigint primary key,content text,derived text generated always as(lower(content)) stored,kind public.snapshot_probe_type);insert into public.snapshot_probe(id,content,kind) values(9007199254740993,'Exact','one');");
  const snapshot=await collectDatabaseSnapshot(client);snapshot.photos=[];
  const restored=decryptBackup(encryptBackup(snapshot,key),key);
  const result=await verifyDatabaseRestore(restored);
  assert.ok(result.tables>10);assert.ok(result.rows>=3);
 }finally{await source.close();}
});
