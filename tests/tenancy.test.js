import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { verifyBillingSchema } from '../scripts/verify-billing-schema.mjs';
import { verifyTenancy } from '../scripts/verify-tenancy.mjs';
import { verifySubscriptionSchema } from '../scripts/verify-subscription-schema.mjs';
import { homeFor, mapUser } from '../src/domain/access.js';

test('routes and profile mapping support all three roles and legacy service JSON', () => {
  assert.equal(homeFor('super_admin'), '/admin');
  assert.equal(homeFor('admin'), '/admin');
  assert.equal(homeFor('dono'), '/barbearia');
  assert.equal(homeFor('barbeiro'), '/dashboard');
  assert.equal(homeFor('forged'), '/login');
  const profile = mapUser({ role:'dono', servicos_config:'[{"name":"Corte","duration":40}]', barbearias:{nome:'Shop',plano:'barbearia',status:'pilot',limite_barbeiros:5} });
  assert.equal(profile.servicosConfig[0].name,'Corte'); assert.equal(profile.plano,'barbearia'); assert.equal(profile.barbeariaName,'Shop');
});

test('real tenant migration preserves legacy data and enforces RLS, seat limits and public booking', async () => {
  const db = new PGlite();
  const client = { query: async (sql, args) => args ? db.query(sql, args) : (await db.exec(sql)).at(-1) || {rows:[]} };
  try {
    await db.exec(await readFile(new URL('./fixtures-legacy.sql', import.meta.url),'utf8'));
    await db.exec('begin');
    await db.exec(await readFile(new URL('../supabase/migrations/20261115_workspaces.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261115194802_workspace_billing.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261115202455_billing_events_and_subscription_management.sql',import.meta.url),'utf8'));
    await verifyTenancy(client);
    await verifyBillingSchema(client);
    await verifySubscriptionSchema(client);
    const original = await db.query("select u.role,b.status,c.nome from public.usuarios u left join public.barbearias b on b.id=u.barbearia_id left join public.clientes c on c.barber_id=u.id order by u.email");
    assert.equal(original.rows.length,2);
    assert.equal(original.rows[0].role,'super_admin');
    assert.equal(original.rows[1].nome,'Preservar cliente');
    assert.equal(original.rows[1].status,'pilot');
    const photo = await db.query("select public from storage.buckets where id='barbermemo-photos'");
    assert.equal(photo.rows[0].public,false);
    await db.exec('rollback');
  } finally { await db.close(); }
});
