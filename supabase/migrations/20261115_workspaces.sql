-- Executed in a transaction by scripts/migrate-tenancy.mjs; see RLS verification before commit.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create table if not exists private.schema_migrations(version text primary key, applied_at timestamptz not null default now());
create table if not exists private.schema_backups(version text primary key, definition jsonb not null, created_at timestamptz not null default now());
insert into private.schema_backups(version,definition) values('20261115_workspaces',jsonb_build_object(
 'legacy_roles',(select jsonb_agg(jsonb_build_object('id',id,'role',role)) from public.usuarios),
 'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname in ('public','storage')),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid))) from pg_proc p where p.pronamespace='public'::regnamespace))) on conflict do nothing;

create table public.barbearias (
 id uuid primary key default gen_random_uuid(), nome text not null check(length(trim(nome)) between 2 and 120),
 owner_id uuid unique references auth.users(id) on delete restrict,
 plano text not null default 'individual' check(plano in ('individual','barbearia')),
 status text not null default 'pilot' check(status in ('pilot','active','suspended')),
 limite_barbeiros integer not null default 1 check(limite_barbeiros between 1 and 100),
 created_at timestamptz not null default now(),
 constraint individual_seat_limit check(plano <> 'individual' or limite_barbeiros=1)
);
alter table public.usuarios drop constraint usuarios_role_check;
alter table public.usuarios add constraint usuarios_role_check check(role in ('admin','super_admin','dono','barbeiro'));
alter table public.usuarios add column barbearia_id uuid references public.barbearias(id) on delete restrict;
alter table public.usuarios add column ativo boolean not null default true;
do $$ begin
 if (select count(*) from public.usuarios where role='admin')<>1 then
   raise exception 'A migração exige identificar a única conta administrativa existente.';
 end if;
 update public.usuarios set role='super_admin' where role='admin';
end $$;
-- Preserve the existing professional profiles; a matching display name is never a membership link.
do $$ declare u record; w uuid; begin
 for u in select * from public.usuarios where role<>'super_admin' or exists(select 1 from public.clientes c where c.barber_id=usuarios.id) loop
  insert into public.barbearias(nome,owner_id,plano,limite_barbeiros,status)
  values(case when length(coalesce(nullif(trim(u.barbearia_name),''),u.nome))<2 then 'Barbearia '||u.nome else left(coalesce(nullif(trim(u.barbearia_name),''),u.nome),120) end,u.id,
    case when u.plano='barbearia' then 'barbearia' else 'individual' end,
    case when u.plano='barbearia' then 5 else 1 end,'pilot') returning id into w;
  update public.usuarios set barbearia_id=w,
   role=case when role='super_admin' then role when u.plano='barbearia' then 'dono' else 'barbeiro' end where id=u.id;
 end loop;
end $$;
alter table public.usuarios drop constraint usuarios_role_check;
alter table public.usuarios add constraint usuarios_role_check check(role in ('super_admin','dono','barbeiro'));
alter table public.usuarios add constraint active_profile_has_workspace check(not ativo or role='super_admin' or barbearia_id is not null);
alter table public.usuarios alter column ativo set default false;

alter table public.clientes add column barbearia_id uuid references public.barbearias(id) on delete restrict;
update public.clientes c set barbearia_id=u.barbearia_id from public.usuarios u where u.id=c.barber_id;
alter table public.clientes alter column barbearia_id set not null;
alter table public.atendimentos add column barbearia_id uuid references public.barbearias(id) on delete restrict;
update public.atendimentos a set barbearia_id=c.barbearia_id from public.clientes c where c.id=a.cliente_id;
alter table public.atendimentos alter column barbearia_id set not null;
alter table public.agendamentos add column barbearia_id uuid references public.barbearias(id) on delete restrict;
alter table public.agendamentos add column tracking_token uuid not null default gen_random_uuid() unique;
update public.agendamentos a set barbearia_id=c.barbearia_id from public.clientes c where c.id=a.cliente_id;
alter table public.agendamentos alter column barbearia_id set not null;
do $$ begin
 if exists(select 1 from public.agendamentos a join public.clientes c on c.id=a.cliente_id where c.barber_id<>a.barber_id) then
  raise exception 'Agendamentos com vínculo de cliente divergente precisam ser revisados antes de migrar.';
 end if;
end $$;
create index on public.usuarios(barbearia_id);
create index on public.clientes(barbearia_id);
create index on public.atendimentos(barbearia_id);
create index on public.agendamentos(barbearia_id,data_hora);
create table private.account_reservations (
 id uuid primary key default gen_random_uuid(), barbearia_id uuid not null references public.barbearias(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade, requested_role text not null check(requested_role in ('dono','barbeiro')),
 expires_at timestamptz not null default now()+interval '10 minutes'
);

create or replace function private.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.usuarios where id=auth.uid() and ativo and role='super_admin')
$$;
create or replace function private.workspace_active(w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.barbearias where id=w and status in ('active','pilot'))
$$;
create or replace function private.owns_workspace(w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.usuarios u join public.barbearias b on b.id=u.barbearia_id where u.id=auth.uid() and u.ativo and u.role='dono' and b.id=w and b.owner_id=u.id and b.status in ('active','pilot'))
$$;
create or replace function private.can_read_barber(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_super_admin() or exists(select 1 from public.usuarios u where u.id=b and private.workspace_active(u.barbearia_id) and (u.id=auth.uid() and u.ativo or private.owns_workspace(u.barbearia_id)))
$$;
create or replace function private.can_work_as(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.usuarios u where u.id=b and u.id=auth.uid() and u.ativo and u.role in ('dono','barbeiro') and private.workspace_active(u.barbearia_id))
$$;
create or replace function private.can_read_photo(folder text) returns boolean language plpgsql stable security definer set search_path='' as $$
 begin return private.can_read_barber(folder::uuid); exception when invalid_text_representation then return false; end
$$;
revoke all on function private.is_super_admin(),private.workspace_active(uuid),private.owns_workspace(uuid),private.can_read_barber(uuid),private.can_work_as(uuid),private.can_read_photo(text) from public;
grant execute on function private.is_super_admin(),private.workspace_active(uuid),private.owns_workspace(uuid),private.can_read_barber(uuid),private.can_work_as(uuid),private.can_read_photo(text) to authenticated;

create or replace function private.guard_profile() returns trigger language plpgsql security definer set search_path='' as $$
 declare w public.barbearias; occupied integer;
 begin
  if coalesce(auth.role(),'')<>'service_role' and not(auth.role() is null and session_user in ('postgres','supabase_admin')) then
   if tg_op='INSERT' then
    new.role:='barbeiro'; new.barbearia_id:=null; new.ativo:=false;
   elsif new.id<>old.id or new.role is distinct from old.role or new.barbearia_id is distinct from old.barbearia_id or new.ativo is distinct from old.ativo or new.email is distinct from old.email or new.asaas_customer_id is distinct from old.asaas_customer_id or new.plano is distinct from old.plano or new.status_assinatura is distinct from old.status_assinatura or new.subscription_id is distinct from old.subscription_id then
    raise exception 'Somente a administração autorizada pode alterar permissões e cobrança.' using errcode='42501';
   end if;
  end if;
  if new.ativo and new.role<>'super_admin' then
   select * into w from public.barbearias where id=new.barbearia_id for update;
   if not found then raise exception 'Barbearia inválida.'; end if;
   if new.role='dono' and (w.plano<>'barbearia' or w.owner_id is distinct from new.id) then raise exception 'O dono deve ser o titular do plano barbearia.'; end if;
   select count(*) into occupied from public.usuarios where barbearia_id=w.id and ativo and role in ('dono','barbeiro') and id<>new.id;
   occupied:=occupied+(select count(*) from private.account_reservations where barbearia_id=w.id and expires_at>now());
   if occupied>=w.limite_barbeiros then raise exception 'Limite de acessos do plano atingido.' using errcode='23514'; end if;
  end if;
  return new;
 end
$$;
create trigger guard_profile before insert or update on public.usuarios for each row execute function private.guard_profile();
create or replace function private.guard_workspace() returns trigger language plpgsql security definer set search_path='' as $$
 declare occupied integer;
 begin
  select count(*) into occupied from public.usuarios where barbearia_id=new.id and ativo and role in ('dono','barbeiro');
  occupied:=occupied+(select count(*) from private.account_reservations where barbearia_id=new.id and expires_at>now());
  if new.limite_barbeiros<occupied then raise exception 'Desative acessos antes de reduzir o limite.' using errcode='23514'; end if;
  return new;
 end
$$;
create trigger guard_workspace before update on public.barbearias for each row execute function private.guard_workspace();
create or replace function private.sync_owner_role() returns trigger language plpgsql security definer set search_path='' as $$
 begin
  if new.plano is distinct from old.plano and new.owner_id is not null then
   update public.usuarios set role=case when new.plano='barbearia' then 'dono' else 'barbeiro' end,plano=case when new.plano='individual' then 'autonomo' else 'barbearia' end where id=new.owner_id and role<>'super_admin';
  end if;
  return new;
 end
$$;
create trigger sync_owner_role after update of plano on public.barbearias for each row execute function private.sync_owner_role();
create or replace function private.stamp_workspace() returns trigger language plpgsql security definer set search_path='' as $$
 declare w uuid; owner uuid; begin
  if tg_table_name='clientes' then
   select barbearia_id into w from public.usuarios where id=new.barber_id and ativo;
  else
   select barbearia_id,barber_id into w,owner from public.clientes where id=new.cliente_id;
   if tg_table_name='agendamentos' then
    if new.barber_id is distinct from owner then raise exception 'O cliente não pertence a este profissional.' using errcode='42501'; end if;
   end if;
  end if;
  if w is null then raise exception 'Vínculo de barbearia inválido.' using errcode='42501'; end if;
  new.barbearia_id:=w; return new;
 end
$$;
create trigger stamp_workspace before insert or update on public.clientes for each row execute function private.stamp_workspace();
create trigger stamp_workspace before insert or update on public.atendimentos for each row execute function private.stamp_workspace();
create trigger stamp_workspace before insert or update on public.agendamentos for each row execute function private.stamp_workspace();

-- Sign-up metadata is never an authorization source. Accounts start inactive until server provisioning finishes.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
 begin
  insert into public.usuarios(id,nome,email,barbearia_name,role,ativo)
  values(new.id,coalesce(nullif(new.raw_user_meta_data->>'nome',''),split_part(new.email,'@',1)),new.email,new.raw_user_meta_data->>'barbearia_name','barbeiro',false)
  on conflict(id) do nothing;
  return new;
 end
$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

-- Replace permissive legacy policies atomically; anonymous access is provided only by safe RPCs below.
do $$ declare p record;begin
 for p in select * from pg_policies where schemaname='public' and tablename in ('usuarios','clientes','atendimentos','agendamentos','assinaturas_asaas','barbearias') loop
  execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
 end loop;
end $$;
alter table public.barbearias enable row level security;
alter table public.usuarios enable row level security;
alter table public.clientes enable row level security;
alter table public.atendimentos enable row level security;
alter table public.agendamentos enable row level security;
alter table public.assinaturas_asaas enable row level security;
revoke all on public.barbearias,public.usuarios,public.clientes,public.atendimentos,public.agendamentos,public.assinaturas_asaas from anon;
revoke all on public.barbearias from authenticated;
grant select on public.barbearias to authenticated;
grant select,update on public.usuarios to authenticated;
revoke insert,delete on public.usuarios from authenticated;
grant select,insert,update,delete on public.clientes,public.atendimentos,public.agendamentos to authenticated;
revoke insert,update,delete on public.assinaturas_asaas from authenticated;
grant select on public.assinaturas_asaas to authenticated;
grant all on public.barbearias to service_role;
create policy workspace_read on public.barbearias for select to authenticated using(private.is_super_admin() or owner_id=auth.uid() or id in(select u.barbearia_id from public.usuarios u where u.id=auth.uid()));
create policy profile_read on public.usuarios for select to authenticated using(id=auth.uid() or private.can_read_barber(id));
create policy profile_update on public.usuarios for update to authenticated using(id=auth.uid() and ativo and private.workspace_active(barbearia_id)) with check(id=auth.uid() and ativo);
create policy clients_read on public.clientes for select to authenticated using(private.can_read_barber(barber_id));
create policy clients_write on public.clientes for insert to authenticated with check(private.can_work_as(barber_id));
create policy clients_update on public.clientes for update to authenticated using(private.can_work_as(barber_id)) with check(private.can_work_as(barber_id));
create policy clients_delete on public.clientes for delete to authenticated using(private.can_work_as(barber_id));
create policy appointments_read on public.agendamentos for select to authenticated using(private.can_read_barber(barber_id));
create policy appointments_insert on public.agendamentos for insert to authenticated with check(private.can_work_as(barber_id));
create policy appointments_update on public.agendamentos for update to authenticated using(private.can_work_as(barber_id)) with check(private.can_work_as(barber_id));
create policy appointments_delete on public.agendamentos for delete to authenticated using(private.can_work_as(barber_id));
create policy attendances_read on public.atendimentos for select to authenticated using(exists(select 1 from public.clientes c where c.id=cliente_id and private.can_read_barber(c.barber_id)));
create policy attendances_insert on public.atendimentos for insert to authenticated with check(exists(select 1 from public.clientes c where c.id=cliente_id and private.can_work_as(c.barber_id)));
create policy attendances_update on public.atendimentos for update to authenticated using(exists(select 1 from public.clientes c where c.id=cliente_id and private.can_work_as(c.barber_id))) with check(exists(select 1 from public.clientes c where c.id=cliente_id and private.can_work_as(c.barber_id)));
create policy attendances_delete on public.atendimentos for delete to authenticated using(exists(select 1 from public.clientes c where c.id=cliente_id and private.can_work_as(c.barber_id)));
create policy subscriptions_super_admin on public.assinaturas_asaas for select to authenticated using(private.is_super_admin());

-- Reservations make the seat limit safe across concurrent invitations and activations.
create function public.reserve_workspace_account(p_actor uuid,p_workspace uuid,p_role text) returns uuid language plpgsql security definer set search_path='' as $$
 declare w public.barbearias; actor public.usuarios; used integer; reservation uuid;begin
 select * into actor from public.usuarios where id=p_actor and ativo;
 if actor.id is null then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 select * into w from public.barbearias where id=p_workspace for update;
 if w.id is null or w.status='suspended' then raise exception 'Barbearia indisponível.' using errcode='42501'; end if;
 if actor.role<>'super_admin' and not(actor.role='dono' and actor.barbearia_id=w.id and w.owner_id=actor.id and w.plano='barbearia' and p_role='barbeiro') then raise exception 'Você não pode cadastrar nesta barbearia.' using errcode='42501'; end if;
 if p_role is null or p_role not in ('barbeiro','dono') or (p_role='dono' and (w.plano<>'barbearia' or w.owner_id is not null)) then raise exception 'Perfil inválido.'; end if;
 delete from private.account_reservations where expires_at<=now();
 select count(*) into used from public.usuarios where barbearia_id=w.id and ativo and role in ('dono','barbeiro');
 used:=used+(select count(*) from private.account_reservations where barbearia_id=w.id and expires_at>now());
 if used>=w.limite_barbeiros then raise exception 'Limite de acessos do plano atingido.' using errcode='23514'; end if;
 insert into private.account_reservations(barbearia_id,actor_id,requested_role) values(w.id,p_actor,p_role) returning id into reservation;
 return reservation;
end $$;
create function public.finish_workspace_account(p_actor uuid,p_reservation uuid,p_user uuid,p_name text,p_email text) returns uuid language plpgsql security definer set search_path='' as $$
 declare reservation private.account_reservations; w public.barbearias; actor public.usuarios;begin
 select * into reservation from private.account_reservations where id=p_reservation and actor_id=p_actor and expires_at>now();
 if reservation.id is null then raise exception 'Reserva de acesso expirada.'; end if;
 select * into w from public.barbearias where id=reservation.barbearia_id for update;
 select * into actor from public.usuarios where id=p_actor and ativo;
 if actor.id is null or w.status='suspended' or (actor.role<>'super_admin' and not(actor.role='dono' and actor.barbearia_id=w.id and w.owner_id=actor.id and reservation.requested_role='barbeiro')) then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 if not exists(select 1 from auth.users where id=p_user and lower(email)=lower(p_email)) then raise exception 'Conta de autenticação inválida.'; end if;
 if exists(select 1 from public.usuarios where id=p_user and (ativo or barbearia_id is not null)) then raise exception 'Este acesso já está vinculado.'; end if;
 if w.owner_id is null then
  if actor.role<>'super_admin' then raise exception 'Somente o super admin pode criar o titular.'; end if;
  update public.barbearias set owner_id=p_user where id=w.id;
 end if;
 delete from private.account_reservations where id=reservation.id;
 update public.usuarios set nome=p_name,email=lower(p_email),barbearia_name=w.nome,barbearia_id=w.id,role=reservation.requested_role,ativo=true,
  plano=case when w.plano='individual' then 'autonomo' else 'barbearia' end where id=p_user;
 if not found then raise exception 'Perfil não foi criado pela autenticação.'; end if;
 return w.id;
end $$;
create function public.cancel_workspace_reservation(p_actor uuid,p_reservation uuid) returns void language sql security definer set search_path='' as $$
 delete from private.account_reservations where id=p_reservation and actor_id=p_actor
$$;
revoke all on function public.reserve_workspace_account(uuid,uuid,text),public.finish_workspace_account(uuid,uuid,uuid,text,text),public.cancel_workspace_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_workspace_account(uuid,uuid,text),public.finish_workspace_account(uuid,uuid,uuid,text,text),public.cancel_workspace_reservation(uuid,uuid) to service_role;

-- Safe, minimal public booking projections. No public table access to names, phones, email or CPF.
create function private.service_list(value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
 declare parsed jsonb;begin
  parsed:=case when jsonb_typeof(value)='string' then (value#>>'{}')::jsonb else value end;
  if jsonb_typeof(parsed)='array' and jsonb_array_length(parsed)>0 then return parsed; end if;
  return '[{"name":"Corte","duration":40,"price":"R$ 40,00"}]'::jsonb;
 exception when others then return '[{"name":"Corte","duration":40,"price":"R$ 40,00"}]'::jsonb;
end $$;
create function public.public_barber_profile(p_barber uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',u.id,'nome',u.nome,'barbearia_id',b.id,'barbearia_name',b.nome,'hora_inicio',u.hora_inicio,'hora_fim',u.hora_fim,'servicos_config',private.service_list(u.servicos_config),'telefone',u.telefone,'modelo_atendimento',u.modelo_atendimento,'status_fila',u.status_fila)
 from public.usuarios u join public.barbearias b on b.id=u.barbearia_id where u.id=p_barber and u.ativo and u.role in ('barbeiro','dono') and b.status in ('active','pilot')
$$;
create function public.public_shop_barbers(p_barber uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(public.public_barber_profile(u.id) order by u.nome),'[]'::jsonb) from public.usuarios u where u.barbearia_id=(select barbearia_id from public.usuarios where id=p_barber and ativo) and u.ativo and u.role in ('barbeiro','dono') and private.workspace_active(u.barbearia_id)
$$;
create function public.public_booked_slots(p_barber uuid,p_date date) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('data_hora',a.data_hora,'servicos',a.servicos,'status',a.status) order by a.data_hora),'[]'::jsonb)
 from public.agendamentos a where a.barber_id=p_barber and (a.data_hora at time zone 'America/Sao_Paulo')::date=p_date and a.status<>'Cancelado' and public.public_barber_profile(p_barber) is not null
$$;
create function public.public_barber_queue(p_barber uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'barber_id',a.barber_id,'data_hora',a.data_hora,'servicos',a.servicos,'status',a.status,'clientes',jsonb_build_object('nome','Cliente '||right(a.id::text,4))) order by a.data_hora),'[]'::jsonb)
 from public.agendamentos a where a.barber_id=p_barber and (a.data_hora at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date and a.status in ('Pendente','Confirmado') and public.public_barber_profile(p_barber) is not null
$$;
create function public.public_booking_status(p_token uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'barber_id',a.barber_id,'data_hora',a.data_hora,'servicos',a.servicos,'status',a.status)
 from public.agendamentos a where a.tracking_token=p_token and public.public_barber_profile(a.barber_id) is not null
$$;
create function public.public_health() returns boolean language sql stable security definer set search_path='' as $$ select count(*)>=0 from public.barbearias $$;
drop function public.create_public_booking(uuid,text,text,timestamptz,text);
create function public.create_public_booking(p_barber_id uuid,p_nome text,p_telefone text,p_data_hora timestamptz,p_servicos text) returns jsonb language plpgsql security definer set search_path='' as $$
 declare u public.usuarios; b public.barbearias; c uuid; a public.agendamentos; service jsonb; duration integer; phone text;begin
 perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text,0));
 select * into u from public.usuarios where id=p_barber_id and ativo and role in ('barbeiro','dono');
 if u.id is null then raise exception 'Profissional indisponível.'; end if;
 select * into b from public.barbearias where id=u.barbearia_id and status in ('pilot','active');
 if b.id is null then raise exception 'Barbearia indisponível.'; end if;
 phone:=regexp_replace(p_telefone,'\D','','g');
 if p_nome is null or p_telefone is null or p_data_hora is null or length(trim(p_nome)) not between 2 and 120 or length(phone) not between 10 and 11 then raise exception 'Confira nome e telefone.'; end if;
 select value into service from jsonb_array_elements(private.service_list(u.servicos_config)) where value->>'name'=p_servicos limit 1;
 if service is null then raise exception 'Serviço indisponível.'; end if;
 duration:=case when (service->>'duration')~'^[0-9]{1,3}$' then least(greatest((service->>'duration')::int,5),480) else 40 end;
 if u.modelo_atendimento='fila' then
  if u.status_fila<>'disponivel' then raise exception 'A fila não está recebendo clientes.'; end if;
  if p_data_hora<now()-interval '2 minutes' or p_data_hora>now()+interval '5 minutes' then raise exception 'Horário inválido para fila.'; end if;
 else
  if p_data_hora<now() or p_data_hora>now()+interval '90 days' then raise exception 'Data fora do período disponível.'; end if;
  if (p_data_hora at time zone 'America/Sao_Paulo')::time<u.hora_inicio::time or ((p_data_hora+duration*interval '1 minute') at time zone 'America/Sao_Paulo')::time>u.hora_fim::time then raise exception 'Horário fora do expediente.'; end if;
  if exists(select 1 from public.agendamentos x where x.barber_id=u.id and x.status<>'Cancelado' and x.data_hora<p_data_hora+duration*interval '1 minute' and x.data_hora+coalesce((select case when (value->>'duration')~'^[0-9]{1,3}$' then least((value->>'duration')::int,480) else 40 end from jsonb_array_elements(private.service_list(u.servicos_config)) where value->>'name'=x.servicos limit 1),40)*interval '1 minute'>p_data_hora) then raise exception 'Este horário acabou de ser reservado. Escolha outro.'; end if;
 end if;
 select id into c from public.clientes where barber_id=u.id and regexp_replace(telefone,'\D','','g')=phone order by created_at limit 1;
 if c is null then insert into public.clientes(nome,telefone,intervalo_dias_retorno,barber_id,barbearia_id) values(trim(p_nome),phone,30,u.id,b.id) returning id into c; end if;
 insert into public.agendamentos(cliente_id,data_hora,servicos,status,barber_id,barbearia_id) values(c,p_data_hora,p_servicos,'Pendente',u.id,b.id) returning * into a;
 return jsonb_build_object('id',a.id,'tracking_token',a.tracking_token,'cliente_id',c,'data_hora',a.data_hora,'servicos',a.servicos,'status',a.status);
end $$;
revoke all on function public.public_barber_profile(uuid),public.public_shop_barbers(uuid),public.public_booked_slots(uuid,date),public.public_barber_queue(uuid),public.public_booking_status(uuid),public.public_health(),public.create_public_booking(uuid,text,text,timestamptz,text) from public;
grant execute on function public.public_barber_profile(uuid),public.public_shop_barbers(uuid),public.public_booked_slots(uuid,date),public.public_barber_queue(uuid),public.public_booking_status(uuid),public.public_health(),public.create_public_booking(uuid,text,text,timestamptz,text) to anon,authenticated,service_role;

-- Existing photo URLs are resolved to signed URLs by the new client; future uploads store only object paths.
update storage.buckets set public=false where id='barbermemo-photos';
do $$ declare p record;begin
 for p in select * from pg_policies where schemaname='storage' and tablename='objects' and (coalesce(qual,'') like '%barbermemo-photos%' or coalesce(with_check,'') like '%barbermemo-photos%') loop
  execute format('drop policy %I on storage.objects',p.policyname);
 end loop;
end $$;
create policy tenant_photos_read on storage.objects for select to authenticated using(bucket_id='barbermemo-photos' and private.can_read_photo((storage.foldername(name))[1]));
create policy tenant_photos_insert on storage.objects for insert to authenticated with check(bucket_id='barbermemo-photos' and (storage.foldername(name))[1]=auth.uid()::text and private.can_work_as(auth.uid()));
create policy tenant_photos_update on storage.objects for update to authenticated using(bucket_id='barbermemo-photos' and (storage.foldername(name))[1]=auth.uid()::text and private.can_work_as(auth.uid())) with check(bucket_id='barbermemo-photos' and (storage.foldername(name))[1]=auth.uid()::text and private.can_work_as(auth.uid()));
create policy tenant_photos_delete on storage.objects for delete to authenticated using(bucket_id='barbermemo-photos' and (storage.foldername(name))[1]=auth.uid()::text and private.can_work_as(auth.uid()));
revoke all on all functions in schema private from public,anon;
notify pgrst,'reload schema';
