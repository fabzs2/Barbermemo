import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Runs against the actual Postgres policies in a savepoint. No fixture survives, even on failure.
export async function verifyTenancy(client) {
  await client.query('savepoint tenancy_fixtures');
  const ids = Object.fromEntries(['ownerA', 'ownerB', 'barberA', 'otherA', 'barberB', 'unassigned', 'shopA', 'shopB', 'clientA', 'clientB', 'clientOther', 'attendanceA', 'bookingA'].map(key => [key, randomUUID()]));
  let checks = 0;
  const query = (sql, values) => client.query(sql, values);
  const value = async (sql, values) => (await query(sql, values)).rows[0]?.value;
  const expect = async (sql, params, wanted, label) => { assert.deepEqual(await value(sql, params), wanted, label); checks++; };
  async function as(role, id) {
    await query('reset role');
    await query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, ...(id ? { sub: id } : {}) })]);
    await query(`set local role ${role}`); // only literal roles from this test, never user input
  }
  async function denied(sql, params, code = '42501') {
    await query('savepoint denied_operation');
    let failure;
    try { await query(sql, params); } catch (error) { failure = error; }
    await query('rollback to savepoint denied_operation');
    assert.equal(failure?.code, code, 'Expected database denial: ' + sql.slice(0, 55)); checks++;
  }
  try {
    await as('service_role');
    const people = ['ownerA', 'ownerB', 'barberA', 'otherA', 'barberB', 'unassigned'];
    for (const key of people) {
      // Seed as database owner, simulating the GoTrue insert and its real profile trigger.
      await query('reset role');
      await query("insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values($1,$2,$3,'{}',now(),now())", [ids[key], `fixture-${ids[key]}@example.invalid`, JSON.stringify({ nome: key, role: 'super_admin', ativo: true, barbearia_id: ids.shopB })]);
    }
    await expect('select role = \'barbeiro\' and not ativo and barbearia_id is null as value from public.usuarios where id=$1', [ids.unassigned], true, 'Signup metadata cannot grant privileges');
    await as('service_role');
    await query("insert into public.barbearias(id,nome,owner_id,plano,limite_barbeiros,status) values($1,'Fixture A',$2,'barbearia',3,'pilot'),($3,'Fixture B',$4,'barbearia',2,'active')", [ids.shopA, ids.ownerA, ids.shopB, ids.ownerB]);
    for (const [key, shop, role] of [['ownerA','shopA','dono'], ['barberA','shopA','barbeiro'], ['otherA','shopA','barbeiro'], ['ownerB','shopB','dono'], ['barberB','shopB','barbeiro']]) {
      await query('update public.usuarios set barbearia_id=$1,role=$2,ativo=true,servicos_config=$3 where id=$4', [ids[shop], role, JSON.stringify([{ name: 'Corte', duration: 40, price: 'R$ 40,00' }]), ids[key]]);
    }
    for (const [key, barber] of [['clientA','barberA'], ['clientB','barberB'], ['clientOther','otherA']]) await query("insert into public.clientes(id,nome,telefone,barber_id) values($1,'Cliente confidencial','11999999999',$2)", [ids[key], ids[barber]]);
    await query('insert into public.atendimentos(id,cliente_id,laterais) values($1,$2,$3)', [ids.attendanceA, ids.clientA, 'fixture']);
    await query("insert into public.agendamentos(id,cliente_id,barber_id,data_hora,servicos,status) values($1,$2,$3,now()+interval '1 day','Corte','Pendente')", [ids.bookingA, ids.clientA, ids.barberA]);
    await as('authenticated', ids.barberA);
    await expect('select count(*)::int as value from public.clientes where id=any($1::uuid[])', [[ids.clientA, ids.clientB, ids.clientOther]], 1, 'A barber sees only their clients');
    await expect('select count(*)::int as value from public.atendimentos where id=$1', [ids.attendanceA], 1, 'Own attendance is readable');
    await denied('update public.usuarios set role=\'super_admin\' where id=$1', [ids.barberA]);
    await denied('update public.usuarios set barbearia_id=$1 where id=$2', [ids.shopB, ids.barberA]);
    await denied('update public.usuarios set asaas_customer_id=\'forged\' where id=$1', [ids.barberA]);
    await denied("insert into public.clientes(nome,telefone,barber_id) values('Cross tenant','11988888888',$1)", [ids.barberB]);
    await denied('insert into public.atendimentos(cliente_id) values($1)', [ids.clientB]);
    await denied('update public.atendimentos set cliente_id=$1 where id=$2', [ids.clientB, ids.attendanceA]);
    await denied('update public.agendamentos set cliente_id=$1 where id=$2', [ids.clientB, ids.bookingA]);
    await denied("select public.reserve_workspace_account($1,$2,'barbeiro')", [ids.barberA, ids.shopA]);
    await expect('select private.can_read_photo($1) as value', [ids.barberB], false, 'Photos from another shop are inaccessible');
    await query("update public.usuarios set telefone='11911111111' where id=$1", [ids.barberA]); checks++;
    await as('authenticated', ids.ownerA);
    await expect('select count(*)::int as value from public.clientes where id=any($1::uuid[])', [[ids.clientA, ids.clientOther, ids.clientB]], 2, 'Owner sees their own shop only');
    await expect('select count(*)::int as value from public.usuarios where id=$1', [ids.ownerB], 0, 'Owner cannot enumerate another shop');
    await denied("update public.usuarios set ativo=false where id=$1", [ids.ownerA]);
    await expect('select private.can_read_photo($1) as value', [ids.barberA], true, 'Owner may read their shop photos');
    await as('service_role');
    await denied("select public.reserve_workspace_account($1,$2,'barbeiro')", [ids.ownerA, ids.shopB]);
    await denied("select public.reserve_workspace_account($1,$2,'dono')", [ids.ownerA, ids.shopA]);
    await denied("select public.reserve_workspace_account($1,$2,'barbeiro')", [ids.ownerA, ids.shopA], '23514');
    await query('update public.usuarios set ativo=false where id=$1', [ids.otherA]);
    const reservation = await value("select public.reserve_workspace_account($1,$2,'barbeiro') as value", [ids.ownerA, ids.shopA]);
    await denied("select public.reserve_workspace_account($1,$2,'barbeiro')", [ids.ownerA, ids.shopA], '23514');
    await denied('update public.usuarios set ativo=true where id=$1', [ids.otherA], '23514');
    await query('select public.finish_workspace_account($1,$2,$3,$4,$5)', [ids.ownerA, reservation, ids.unassigned, 'New barber', `fixture-${ids.unassigned}@example.invalid`]);
    await expect('select ativo and role=\'barbeiro\' and barbearia_id=$1 as value from public.usuarios where id=$2', [ids.shopA, ids.unassigned], true, 'Reserved account is provisioned into the intended shop');
    await denied('update public.barbearias set limite_barbeiros=1,plano=\'individual\' where id=$1', [ids.shopA], '23514');
    const token = await value('select tracking_token as value from public.agendamentos where id=$1', [ids.bookingA]);
    await as('anon');
    for (const table of ['usuarios', 'clientes', 'atendimentos', 'agendamentos', 'assinaturas_asaas', 'barbearias']) await denied(`select * from public.${table} limit 1`);
    await denied("select public.reserve_workspace_account($1,$2,'barbeiro')", [ids.ownerA, ids.shopA]);
    const profile = await value('select public.public_barber_profile($1) as value', [ids.barberA]);
    assert.equal(profile.nome, 'barberA');
    for (const key of ['email', 'cpf_cnpj', 'asaas_customer_id', 'subscription_id']) assert.equal(profile[key], undefined);
    checks++;
    await expect('select jsonb_array_length(public.public_shop_barbers($1))::int as value', [ids.barberA], 3, 'Public shop list uses stable tenant id');
    await expect('select public.public_booking_status($1) as value', [ids.bookingA], null, 'Booking id does not allow tracking');
    await expect('select public.public_booking_status($1)->>\'status\' as value', [token], 'Pendente', 'Secret tracking token works');
    // Exercise the actual public booking procedure, overlap lock and safe projections.
    const when = await value("select (((now() at time zone 'America/Sao_Paulo')::date+2)+time '10:00') at time zone 'America/Sao_Paulo' as value");
    const booking = await value('select public.create_public_booking($1,$2,$3,$4,$5) as value', [ids.barberA, 'Teste público', '11988887777', when, 'Corte']);
    assert.ok(booking.tracking_token); checks++;
    await denied('select public.create_public_booking($1,$2,$3,$4,$5)', [ids.barberA, 'Teste público', '11988887777', when, 'Corte'], 'P0001');
    await denied('select public.create_public_booking($1,null,$2,$3,$4)', [ids.barberA, '11988887777', when, 'Corte'], 'P0001');
    const slots = await value("select public.public_booked_slots($1,($2::timestamptz at time zone 'America/Sao_Paulo')::date) as value", [ids.barberA, when]);
    assert.ok(slots.length);
    assert.ok(slots.every(slot => Object.keys(slot).every(key => ['data_hora', 'status', 'servicos'].includes(key)))); checks++;
    await as('service_role');
    await query("update public.barbearias set status='suspended' where id=$1", [ids.shopA]);
    await as('authenticated', ids.barberA);
    await expect('select count(*)::int as value from public.clientes where id=$1', [ids.clientA], 0, 'Paused shop loses customer access with existing JWT');
    await denied("insert into public.clientes(nome,telefone,barber_id) values('Paused','11988887777',$1)", [ids.barberA]);
    await as('anon');
    await expect('select public.public_barber_profile($1) as value', [ids.barberA], null, 'Paused shop disappears from public booking');
    await expect('select public.public_booking_status($1) as value', [token], null, 'Paused shop tracking is unavailable');
    await as('service_role');
    await query("update public.barbearias set status='pilot' where id=$1", [ids.shopA]);
    await query('update public.usuarios set ativo=false where id=$1', [ids.barberA]);
    await as('authenticated', ids.barberA);
    await expect('select count(*)::int as value from public.clientes where id=$1', [ids.clientA], 0, 'Inactive member loses access without waiting for JWT expiry');
    console.log(`Tenant isolation: ${checks} database checks passed; fixtures rolled back.`);
  } finally {
    await query('rollback to savepoint tenancy_fixtures');
    await query('release savepoint tenancy_fixtures');
  }
}
