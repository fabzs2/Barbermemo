import { connectDatabase } from './database.mjs';
const client=await connectDatabase();
if(client) {
 try {
  await client.query('BEGIN READ ONLY');
  const q=async(sql)=>(await client.query(sql)).rows;
  const metadata={
   columns:await q("select table_name,column_name,data_type,is_nullable,(column_default is not null) as has_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position"),
   constraints:await q("select conrelid::regclass::text as table_name,conname,contype,pg_get_constraintdef(oid) as definition from pg_constraint where connamespace='public'::regnamespace"),
   policies:await q("select schemaname,tablename,policyname,cmd,roles,qual,with_check from pg_policies where schemaname in ('public','storage')"),
   functions:await q("select p.oid::regprocedure::text as signature,p.prosecdef as security_definer from pg_proc p where p.pronamespace='public'::regnamespace"),
   triggers:await q("select tgrelid::regclass::text as table_name,tgname,tgfoid::regprocedure::text as function_name from pg_trigger where not tgisinternal and tgrelid in ('public.usuarios'::regclass,'public.clientes'::regclass,'public.atendimentos'::regclass,'public.agendamentos'::regclass,'auth.users'::regclass)"),
   roles:await q('select role,count(*)::int as accounts from public.usuarios group by role'),
   legacyAdministrators:await q("select id,email from public.usuarios where role='admin' limit 10"),
   privileges:await q("select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')"),
  };
  console.log('TENANCY_SCHEMA_METADATA '+JSON.stringify(metadata));
  await client.query('ROLLBACK');
 } finally {await client.end();}
}
