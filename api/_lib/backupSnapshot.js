import {createHash} from 'node:crypto';
export const quoteIdent=value=>'"'+String(value).replaceAll('"','""')+'"';
export const tableName=(schema,table)=>`${quoteIdent(schema)}.${quoteIdent(table)}`;
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const role=value=>value==='PUBLIC'?'PUBLIC':quoteIdent(value);
export async function collectDatabaseSnapshot(client) {
 await client.query('begin isolation level repeatable read read only');
 try {
  await client.query("set local timezone='UTC'");
  const tables=(await client.query("select n.nspname as schema,c.relname as name,c.oid,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname in ('public','private') or (n.nspname='auth' and c.relname in ('users','identities'))) order by n.nspname,c.relname")).rows;
  const snapshot={format:'barbermemo-application-backup-v1',createdAt:new Date().toISOString(),databaseVersion:(await client.query('show server_version')).rows[0].server_version,tables:[],functions:[],enums:[],constraints:[],indexes:[],triggers:[],policies:[],tableGrants:[],functionGrants:[],authSupport:[]};
  for(const table of tables) {
   const columns=(await client.query("select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as required,a.attgenerated as generated,pg_get_expr(d.adbin,d.adrelid) as expression from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=$1::oid and a.attnum>0 and not a.attisdropped order by a.attnum",[table.oid])).rows;
   if(columns.some(c=>c.expression?.includes('nextval(')))throw new Error('Sequence-backed tables require an updated backup format.');
   const definition=`create table ${tableName(table.schema,table.name)} (${columns.map(c=>`${quoteIdent(c.name)} ${c.type}${c.generated?` generated always as (${c.expression}) stored`:c.expression?` default ${c.expression}`:''}${c.required?' not null':''}`).join(',')});`;
   const rows=(await client.query(`select to_jsonb(t)::text as row from ${tableName(table.schema,table.name)} t`)).rows.map(x=>x.row).sort();
   snapshot.tables.push({schema:table.schema,name:table.name,rls:table.rls,forceRls:table.force_rls,definition,columns:columns.filter(c=>!c.generated).map(c=>c.name),rows,hash:sha256(rows.join('\n'))});
  }
  snapshot.enums=(await client.query("select n.nspname as schema,t.typname as name,array_agg(e.enumlabel order by e.enumsortorder) as labels from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname in ('public','private','auth','storage') group by n.nspname,t.typname")).rows.map(e=>`create type ${tableName(e.schema,e.name)} as enum (${e.labels.map(literal).join(',')});`);
  snapshot.constraints=(await client.query("select n.nspname as schema,c.relname as name,k.conname,pg_get_constraintdef(k.oid) as definition,k.contype from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') or (n.nspname='auth' and c.relname in ('users','identities') and k.contype in ('p','u')) order by case when k.contype='f' then 1 else 0 end")).rows;
  snapshot.functions=(await client.query("select pg_get_functiondef(p.oid) as definition,format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')")).rows;
  snapshot.authSupport=(await client.query("select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='auth' and p.proname in ('uid','role','jwt')) or (n.nspname='storage' and p.proname='foldername')")).rows.map(x=>x.definition);
  snapshot.indexes=(await client.query("select pg_get_indexdef(i.indexrelid) as definition from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)")).rows.map(x=>x.definition+';');
  snapshot.triggers=(await client.query("select pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and (n.nspname in ('public','private') or (n.nspname='auth' and c.relname='users' and t.tgname='on_auth_user_created'))")).rows.map(x=>x.definition+';');
  snapshot.policies=(await client.query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private') or (schemaname='storage' and tablename='objects' and (coalesce(qual,'') like '%barbermemo-photos%' or coalesce(with_check,'') like '%barbermemo-photos%'))")).rows;
  snapshot.tableGrants=(await client.query("select n.nspname as schema,c.relname as name,case when a.grantee=0 then 'PUBLIC' else r.rolname end as role,a.privilege_type as privilege from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles r on r.oid=a.grantee where c.relkind='r' and n.nspname in ('public','private') and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role'))")).rows;
  snapshot.functionGrants=(await client.query("select format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) as signature,case when a.grantee=0 then 'PUBLIC' else r.rolname end as role from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee where n.nspname in ('public','private') and p.prokind='f' and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role'))")).rows;
  await client.query('commit');return snapshot;
 }catch(error){await client.query('rollback');throw error;}
}
export function policySql(p) {
 return `create policy ${quoteIdent(p.policyname)} on ${tableName(p.schemaname,p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(r=>role(r==='public'?'PUBLIC':r)).join(',')}${p.qual?` using (${p.qual})`:''}${p.with_check?` with check (${p.with_check})`:''};`;
}
export function restorationSql(snapshot) {
 const schemas="create schema if not exists private; create schema if not exists auth; create schema if not exists storage;";
 const structure=snapshot.tables.filter(t=>t.schema!=='auth').map(t=>t.definition).join('\n');
 const constraints=snapshot.constraints.filter(c=>c.schema!=='auth').map(c=>`alter table ${tableName(c.schema,c.name)} add constraint ${quoteIdent(c.conname)} ${c.definition};`).join('\n');
 const security=snapshot.tables.filter(t=>t.schema!=='auth').map(t=>`revoke all on ${tableName(t.schema,t.name)} from public,anon,authenticated,service_role;${t.rls?`alter table ${tableName(t.schema,t.name)} enable row level security;`:''}${t.forceRls?`alter table ${tableName(t.schema,t.name)} force row level security;`:''}`).join('\n');
 // Functions can reference functions created later in the catalog snapshot.
 const functions="set check_function_bodies=off;\n"+snapshot.functions.map(f=>f.definition+';').join('\n')+"\nset check_function_bodies=on;";
 const revoke=snapshot.functions.map(f=>`revoke all on function ${f.signature} from public,anon,authenticated,service_role;`).join('\n');
 const grants=snapshot.tableGrants.map(g=>`grant ${g.privilege} on ${tableName(g.schema,g.name)} to ${role(g.role)};`).join('\n')+'\n'+snapshot.functionGrants.map(g=>`grant execute on function ${g.signature} to ${role(g.role)};`).join('\n');
 return {schemas,structure,constraints,functions,finish:[...snapshot.indexes,...snapshot.triggers,security,'revoke all on schema private from public;grant usage on schema private to authenticated;',...snapshot.policies.map(policySql),revoke,grants].join('\n')};
}
export async function restoreRows(database,snapshot) {
 for(const table of snapshot.tables) {
  if(!table.rows.length)continue;
  const cols=table.columns.map(quoteIdent).join(',');
  const sql=`insert into ${tableName(table.schema,table.name)} (${cols}) select ${cols} from jsonb_populate_recordset(null::${tableName(table.schema,table.name)},$1::jsonb)`;
  await database.query(sql,['['+table.rows.join(',')+']']);
 }
}
