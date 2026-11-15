import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { connectDatabase } from './database.mjs';

// One-time smoke test of the deployed API + GoTrue + real RLS. Disposable accounts only;
// never impersonates a real administrator or changes an existing user's credentials.
const version = '20261115_provisioning_verified';
if (process.env.VERCEL_ENV === 'production') {
  const db = await connectDatabase();
  if (!db) throw new Error('Database required for provisioning verification.');
  const done = (await db.query('select 1 from private.schema_migrations where version=$1', [version])).rowCount;
  if (done) { console.log('Production provisioning already verified.'); await db.end(); }
  else {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(url, key, options);
    const tag = randomUUID();
    const suffix = `qa-${tag}@example.invalid`;
    const prefix = `QA ${tag}`;
    const password = randomBytes(24).toString('base64url');
    const email = who => `${who}-${suffix}`;
    let passed = false, checks = 0, stage = 'start';
    function check(value, label) { if (!value) throw new Error(label); checks++; }
    async function api(token, body, workspaceId) {
      const response = await fetch('https://www.barbermemo.com.br/api/workspaces' + (workspaceId ? '?workspaceId=' + workspaceId : ''), {
        method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? {body:JSON.stringify(body)} : {}), signal: AbortSignal.timeout(25000)
      });
      return { status: response.status, body: await response.json() };
    }
    async function login(who) {
      const client = createClient(url, anonKey, options);
      const result = await client.auth.signInWithPassword({ email: email(who), password });
      check(!result.error && result.data.session?.access_token, 'Fixture login failed');
      return { client, token: result.data.session.access_token };
    }
    try {
      stage = 'temporary administrator';
      const auth = await admin.auth.admin.createUser({ email: email('admin'), password, email_confirm: true, user_metadata: {nome:prefix} });
      check(!auth.error && auth.data.user?.id, 'Service Auth account creation failed');
      await db.query("update public.usuarios set role='super_admin',ativo=true where id=$1", [auth.data.user.id]);
      const root = await login('admin');
      stage = 'owner provisioning';
      const shop = await api(root.token, {action:'create_workspace',workspaceName:prefix+' Shop',plano:'barbearia',limiteBarbeiros:2,nome:'QA Owner',email:email('owner'),password});
      check(shop.status === 201 && shop.body.member?.role === 'dono', 'Shop owner creation failed');
      stage = 'individual provisioning';
      const individual = await api(root.token, {action:'create_workspace',workspaceName:prefix+' Individual',plano:'individual',limiteBarbeiros:1,nome:'QA Individual',email:email('individual'),password});
      check(individual.status === 201 && individual.body.member?.role === 'barbeiro', 'Individual account creation failed');
      const owner = await login('owner');
      const list = await api(owner.token);
      check(list.status === 200 && list.body.workspaces?.length === 1 && list.body.selected?.id === shop.body.workspaceId, 'Owner workspace scope failed');
      stage = 'team provisioning';
      const member = await api(owner.token, {action:'add_barber',workspaceId:shop.body.workspaceId,nome:'QA Barber',email:email('barber'),password,role:'super_admin'});
      check(member.status === 201 && member.body.member?.role === 'barbeiro', 'Barber creation or role derivation failed');
      const extra = await api(owner.token, {action:'add_barber',workspaceId:shop.body.workspaceId,nome:'QA Overflow',email:email('overflow'),password});
      check(extra.status === 409, 'Seat limit enforcement failed');
      const edit = await api(owner.token, {action:'update_workspace',workspaceId:shop.body.workspaceId,workspaceName:prefix,plano:'barbearia',limiteBarbeiros:99});
      check(edit.status === 403, 'Owner plan escalation was accepted');
      stage = 'authenticated isolation';
      const barber = await login('barber');
      const forbidden = await api(barber.token);
      check(forbidden.status === 403, 'Barber gained management access');
      const clients = await admin.from('clientes').insert([
        {nome:'QA Own client',telefone:'11999990000',barber_id:member.body.member.id},
        {nome:'QA Other shop client',telefone:'11999990001',barber_id:individual.body.member.id}
      ]).select('id,barber_id');
      check(!clients.error && clients.data?.length === 2, 'Fixture clients failed');
      const scoped = await barber.client.from('clientes').select('id').in('id',clients.data.map(c=>c.id));
      check(!scoped.error && scoped.data?.length === 1, 'Authenticated PostgREST isolation failed');
      const profile = await barber.client.from('usuarios').select('role,ativo,barbearias(nome,plano,status)').eq('id', member.body.member.id).single();
      check(!profile.error && profile.data?.role === 'barbeiro' && profile.data.barbearias?.status === 'pilot', 'Profile hydration failed');
      const paused = await api(root.token, {action:'set_workspace_status',workspaceId:shop.body.workspaceId,status:'suspended'});
      check(paused.status === 200, 'Pausing workspace failed');
      const denied = await barber.client.from('clientes').select('id').in('id',clients.data.map(c=>c.id));
      check(!denied.error && denied.data?.length === 0, 'Paused session retained client access');
      passed = true;
    } catch {
      console.error('Production provisioning check failed at:',stage);
      process.exitCode = 1;
    } finally {
      // A unique random suffix limits cleanup strictly to accounts created by this run.
      const users = (await db.query('select id from auth.users where email like $1', ['%-'+suffix])).rows.map(u=>u.id);
      const shops = (await db.query('select id from public.barbearias where nome like $1', [prefix+'%'])).rows.map(w=>w.id);
      await db.query('begin');
      try {
        await db.query('update public.usuarios set ativo=false where id=any($1::uuid[])',[users]);
        await db.query('update public.barbearias set owner_id=null where id=any($1::uuid[])',[shops]);
        await db.query('delete from public.clientes where barbearia_id=any($1::uuid[])',[shops]);
        await db.query('delete from public.usuarios where id=any($1::uuid[])',[users]);
        await db.query('delete from public.barbearias where id=any($1::uuid[])',[shops]);
        await db.query('commit');
      } catch (error) { await db.query('rollback'); throw error; }
      for (const id of users) {
        const result = await admin.auth.admin.deleteUser(id);
        if (result.error) throw new Error('Temporary Auth fixture cleanup failed.');
      }
      check(!(await db.query('select 1 from auth.users where email like $1',['%-'+suffix])).rowCount, 'Auth fixtures remain');
      check(!(await db.query('select 1 from public.barbearias where nome like $1',[prefix+'%'])).rowCount, 'Workspace fixtures remain');
      if (passed) {
        await db.query('insert into private.schema_migrations(version) values($1) on conflict do nothing',[version]);
        console.log(`Production provisioning: ${checks} checks passed; temporary Auth accounts and workspace data removed.`);
      }
      await db.end();
    }
  }
}
