alter table public.barbearia_cobrancas drop constraint barbearia_cobrancas_state_check;
alter table public.barbearia_cobrancas add constraint barbearia_cobrancas_state_check check(state in ('none','creating','ready','uncertain','error','canceled'));
alter table public.barbearia_cobrancas add column subscription_status text;
alter table public.barbearia_cobrancas add column subscription_observed_at timestamptz;
create table public.billing_subscription_links (
 subscription_id text primary key, barbearia_id uuid not null references public.barbearias(id) on delete cascade,
 customer_id text not null, status text not null default 'ACTIVE', observed_at timestamptz not null default now()
);
create index on public.billing_subscription_links(barbearia_id);
insert into public.billing_subscription_links(subscription_id,barbearia_id,customer_id) select subscription_id,barbearia_id,customer_id from public.barbearia_cobrancas where subscription_id is not null and customer_id is not null;
update public.barbearia_cobrancas set subscription_status='ACTIVE' where subscription_id is not null and state='ready';
create table public.billing_payments (
 id text primary key, barbearia_id uuid not null references public.barbearias(id) on delete cascade,
 subscription_id text not null, value_cents integer not null check(value_cents>=0), status text not null,
 due_date date, payment_date date, invoice_url text, observed_at timestamptz not null
);
create index on public.billing_payments(barbearia_id,due_date desc);
create table private.asaas_event_receipts (
 id text primary key, event_type text not null, resource_id text not null, barbearia_id uuid references public.barbearias(id) on delete cascade,
 outcome text not null, received_at timestamptz not null default now()
);
alter table private.asaas_event_receipts enable row level security;
create table public.billing_operations (
 id uuid primary key default gen_random_uuid(), barbearia_id uuid not null references public.barbearias(id) on delete cascade,
 created_by uuid not null references auth.users(id), actor_id uuid not null references auth.users(id), action text not null check(action in ('cancel','change_plan')),
 target_plan text, target_seats integer, previous_state text not null, state text not null check(state in ('running','uncertain','complete','rejected')),
 lease_token uuid not null default gen_random_uuid(), started_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_open_billing_operation on public.billing_operations(barbearia_id) where state in ('running','uncertain');
create table public.service_status (
 key text primary key, checked_at timestamptz not null default now(), success boolean not null, details jsonb not null default '{}'::jsonb
);
-- Operations data is never writable by browser clients, including administrators.
alter table public.billing_subscription_links enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_operations enable row level security;
alter table public.service_status enable row level security;
revoke all on public.billing_subscription_links,public.billing_payments,public.billing_operations,public.service_status from public,anon,authenticated;
grant select on public.billing_subscription_links,public.billing_payments,public.billing_operations,public.service_status to authenticated;
grant all on public.billing_subscription_links,public.billing_payments,public.billing_operations,public.service_status to service_role;
create policy links_super_read on public.billing_subscription_links for select to authenticated using(private.is_super_admin());
create policy payments_super_read on public.billing_payments for select to authenticated using(private.is_super_admin());
create policy operations_super_read on public.billing_operations for select to authenticated using(private.is_super_admin());
create policy service_status_super_read on public.service_status for select to authenticated using(private.is_super_admin());

create function private.link_billing_subscription() returns trigger language plpgsql security definer set search_path='' as $$
 begin
  if new.subscription_id is not null and new.customer_id is not null then
   insert into public.billing_subscription_links(subscription_id,barbearia_id,customer_id,status)
   values(new.subscription_id,new.barbearia_id,new.customer_id,coalesce(new.subscription_status,'ACTIVE'))
   on conflict(subscription_id) do update set status=excluded.status where billing_subscription_links.barbearia_id=excluded.barbearia_id and billing_subscription_links.customer_id=excluded.customer_id;
  end if;
  return new;
 end
$$;
create trigger link_billing_subscription after insert or update of subscription_id,customer_id,subscription_status on public.barbearia_cobrancas for each row execute function private.link_billing_subscription();

create function public.apply_billing_snapshot(p_event_id text,p_event_type text,p_kind text,p_data jsonb,p_observed timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
 declare link public.billing_subscription_links; resource text:=p_data->>'id'; sub text; outcome text:='applied';
 begin
  if length(p_event_id)>180 or p_event_id is null or p_observed is null or p_observed>now()+interval '5 minutes' then raise exception 'Evento inválido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('asaas:'||resource,0));
  if exists(select 1 from private.asaas_event_receipts where id=p_event_id) then return '{"status":"duplicate"}'::jsonb; end if;
  if p_kind='payment' then sub:=p_data->>'subscription'; elsif p_kind='subscription' then sub:=resource; else raise exception 'Recurso inválido.'; end if;
  select * into link from public.billing_subscription_links where subscription_id=sub;
  if link.subscription_id is null then return '{"status":"unlinked"}'::jsonb; end if;
  if p_data->>'customer' is distinct from link.customer_id then raise exception 'Cliente divergente.' using errcode='42501'; end if;
  if p_kind='payment' then
   if resource!~'^pay_[A-Za-z0-9]+$' or (p_data->>'value_cents')::integer<0 then raise exception 'Cobrança inválida.'; end if;
   insert into public.billing_payments(id,barbearia_id,subscription_id,value_cents,status,due_date,payment_date,invoice_url,observed_at)
   values(resource,link.barbearia_id,sub,(p_data->>'value_cents')::integer,p_data->>'status',(p_data->>'due_date')::date,(p_data->>'payment_date')::date,p_data->>'invoice_url',p_observed)
   on conflict(id) do update set value_cents=excluded.value_cents,status=excluded.status,due_date=excluded.due_date,payment_date=excluded.payment_date,invoice_url=excluded.invoice_url,observed_at=excluded.observed_at
   where billing_payments.barbearia_id=excluded.barbearia_id and billing_payments.subscription_id=excluded.subscription_id and billing_payments.observed_at<=excluded.observed_at;
   if not found then outcome:='stale'; end if;
  else
   update public.billing_subscription_links set status=p_data->>'status',observed_at=p_observed where subscription_id=sub and observed_at<=p_observed;
   update public.barbearia_cobrancas set subscription_status=p_data->>'status',subscription_observed_at=p_observed,updated_at=now(),
    state=case when p_data->>'status'='DELETED' and state<>'creating' then 'canceled' else state end
    where subscription_id=sub and coalesce(subscription_observed_at,'-infinity'::timestamptz)<=p_observed;
  end if;
  insert into private.asaas_event_receipts(id,event_type,resource_id,barbearia_id,outcome) values(p_event_id,p_event_type,resource,link.barbearia_id,outcome);
  return jsonb_build_object('status',outcome,'workspaceId',link.barbearia_id);
 end
$$;
create function public.billing_overview(p_workspace uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'overdueCount',count(*) filter(where status='OVERDUE'),
  'pendingCount',count(*) filter(where status='PENDING'),
  'lastPaidAt',max(payment_date) filter(where status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')),
  'nextDueDate',min(due_date) filter(where status in ('PENDING','OVERDUE')),
  'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.due_date desc) from (select id,status,value_cents,due_date,payment_date,invoice_url from public.billing_payments where barbearia_id=p_workspace order by due_date desc nulls last limit 20)x),'[]'::jsonb)
 ) from public.billing_payments where barbearia_id=p_workspace
$$;

create function public.claim_subscription_change(p_actor uuid,p_workspace uuid,p_action text,p_target text,p_seats integer) returns jsonb language plpgsql security definer set search_path='' as $$
 declare w public.barbearias; b public.barbearia_cobrancas; op public.billing_operations; used integer; token uuid:=gen_random_uuid();
 begin
  if not exists(select 1 from public.usuarios where id=p_actor and ativo and role='super_admin') then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
  select * into w from public.barbearias where id=p_workspace for update;
  select * into b from public.barbearia_cobrancas where barbearia_id=w.id for update;
  if b.subscription_id is null then raise exception 'Assinatura não vinculada.' using errcode='23514'; end if;
  if p_action not in ('cancel','change_plan') or p_action is null then raise exception 'Operação inválida.'; end if;
  if p_action='change_plan' then
   if p_target not in ('individual','barbearia') or p_target is null or p_seats is null or p_seats not between 1 and 100 or (p_target='individual' and p_seats<>1) then raise exception 'Plano inválido.'; end if;
   select count(*) into used from public.usuarios where barbearia_id=w.id and ativo and role in ('dono','barbeiro');
   used:=used+(select count(*) from private.account_reservations where barbearia_id=w.id and expires_at>now());
   if used>p_seats then raise exception 'Desative acessos antes de reduzir o limite.' using errcode='23514'; end if;
  end if;
  select * into op from public.billing_operations where barbearia_id=w.id and state in ('running','uncertain') for update;
  if op.id is not null then
   if op.action<>p_action or op.target_plan is distinct from p_target or op.target_seats is distinct from p_seats then raise exception 'Confira a operação existente antes de alterar os termos.' using errcode='23514'; end if;
   if op.state='running' and op.started_at>now()-interval '90 seconds' then return '{"acquired":false}'::jsonb; end if;
   update public.billing_operations set lease_token=token,actor_id=p_actor,state='running',started_at=now(),updated_at=now() where id=op.id returning * into op;
  else
   if b.state='creating' and b.started_at>now()-interval '90 seconds' then return '{"acquired":false}'::jsonb; end if;
   insert into public.billing_operations(barbearia_id,created_by,actor_id,action,target_plan,target_seats,previous_state,state,lease_token)
   values(w.id,p_actor,p_actor,p_action,p_target,p_seats,b.state,'running',token) returning * into op;
  end if;
  update public.barbearia_cobrancas set state='creating',lease_token=token,started_at=now(),updated_at=now() where barbearia_id=w.id;
  return jsonb_build_object('acquired',true,'operation',to_jsonb(op),'billing',to_jsonb(b));
 end
$$;
create function public.finish_subscription_change(p_actor uuid,p_operation uuid,p_lease uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
 declare op public.billing_operations; b public.barbearia_cobrancas; w public.barbearias; cents integer;
 begin
  if not exists(select 1 from public.usuarios where id=p_actor and ativo and role='super_admin') then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
  select barbearia_id into w.id from public.billing_operations where id=p_operation;
  perform 1 from public.barbearias where id=w.id for update;
  select * into op from public.billing_operations where id=p_operation and actor_id=p_actor and lease_token=p_lease and state='running' for update;
  if op.id is null then raise exception 'Operação desatualizada.' using errcode='42501'; end if;
  select * into b from public.barbearia_cobrancas where barbearia_id=op.barbearia_id for update;
  if p_result->>'id' is distinct from b.subscription_id or p_result->>'customer' is distinct from b.customer_id then raise exception 'Vínculo divergente.' using errcode='42501'; end if;
  if op.action='cancel' then
   if p_result->>'status'<>'DELETED' then raise exception 'Cancelamento não confirmado.'; end if;
   update public.barbearia_cobrancas set state='canceled',subscription_status='DELETED',subscription_observed_at=now(),invoice_url=null,updated_at=now() where barbearia_id=op.barbearia_id;
   update public.billing_operations set state='complete',updated_at=now() where id=op.id;
   update public.barbearias set status='suspended' where id=op.barbearia_id;
   update public.usuarios set status_assinatura='CANCELED' where id=(select owner_id from public.barbearias where id=op.barbearia_id);
  else
   cents:=case when op.target_plan='individual' then 5990 else 18999 end;
   if p_result->>'status'<>'ACTIVE' or p_result->>'billingType'<>'PIX' or p_result->>'cycle'<>'MONTHLY' or (p_result->>'amount_cents')::integer<>cents then raise exception 'Alteração não confirmada.'; end if;
   update public.barbearia_cobrancas set plan=op.target_plan,amount_cents=cents,state='ready',subscription_status='ACTIVE',subscription_observed_at=now(),updated_at=now() where barbearia_id=op.barbearia_id;
   update public.billing_operations set state='complete',updated_at=now() where id=op.id;
   update public.barbearias set plano=op.target_plan,limite_barbeiros=op.target_seats where id=op.barbearia_id;
  end if;
 end
$$;
create function public.fail_subscription_change(p_actor uuid,p_operation uuid,p_lease uuid,p_rejected boolean) returns void language plpgsql security definer set search_path='' as $$
 declare op public.billing_operations;
 begin
  if not exists(select 1 from public.usuarios where id=p_actor and ativo and role='super_admin') then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
  select * into op from public.billing_operations where id=p_operation and actor_id=p_actor and lease_token=p_lease and state='running' for update;
  if op.id is null then raise exception 'Operação desatualizada.' using errcode='42501'; end if;
  update public.billing_operations set state=case when p_rejected then 'rejected' else 'uncertain' end,updated_at=now() where id=op.id;
  update public.barbearia_cobrancas set state=case when p_rejected then op.previous_state else 'uncertain' end,updated_at=now() where barbearia_id=op.barbearia_id and lease_token=p_lease;
 end
$$;

create function private.guard_subscription_membership() returns trigger language plpgsql security definer set search_path='' as $$
 begin
  if tg_table_name='usuarios' then
   if not new.ativo then return new; end if;
   if tg_op='UPDATE' then if old.ativo and new.barbearia_id is not distinct from old.barbearia_id then return new; end if; end if;
  end if;
  if exists(select 1 from public.billing_operations where barbearia_id=new.barbearia_id and state in ('running','uncertain')) then raise exception 'Aguarde a alteração da assinatura antes de adicionar acessos.' using errcode='42501'; end if;
  return new;
 end
$$;
create trigger guard_subscription_membership before insert or update of ativo,barbearia_id on public.usuarios for each row execute function private.guard_subscription_membership();
create trigger guard_subscription_reservation before insert on private.account_reservations for each row execute function private.guard_subscription_membership();

create or replace function private.guard_billing_workspace() returns trigger language plpgsql security definer set search_path='' as $$
 declare b public.barbearia_cobrancas;
 begin
  select * into b from public.barbearia_cobrancas where barbearia_id=old.id;
  if b.state='creating' and b.started_at>now()-interval '90 seconds' and (new.plano is distinct from old.plano or new.status is distinct from old.status or new.owner_id is distinct from old.owner_id) then
   -- Completion sets the ledger ready first, in the same transaction.
   raise exception 'Aguarde a ativação em andamento.' using errcode='23514';
  end if;
  if new.plano is distinct from old.plano and (b.subscription_id is not null or b.subscription_attempted) and b.subscription_status is distinct from 'DELETED' and b.plan is distinct from new.plano then
   raise exception 'Revise a assinatura no Asaas antes de mudar o plano.' using errcode='23514';
  end if;
  if new.status is distinct from old.status and exists(select 1 from public.billing_operations where barbearia_id=old.id and state in ('running','uncertain')) then raise exception 'Aguarde a alteração da assinatura.' using errcode='23514'; end if;
  if new.status='pilot' and new.status is distinct from old.status and (b.subscription_id is not null or b.subscription_attempted) then
   raise exception 'Uma assinatura existente não pode ser marcada como piloto sem cobrança.' using errcode='23514';
  end if;
  if new.owner_id is distinct from old.owner_id and b.customer_id is not null then
   raise exception 'Revise o titular da cobrança antes de alterar o vínculo.' using errcode='23514';
  end if;
  if new.status='active' and new.status is distinct from old.status and (b.state is distinct from 'ready' or b.subscription_id is null) then
   raise exception 'Confirme a assinatura antes de ativar o acesso pago.' using errcode='42501';
  end if;
  return new;
 end
$$;

create or replace function public.begin_workspace_billing(p_actor uuid,p_workspace uuid,p_plan text,p_amount integer,p_due date) returns jsonb language plpgsql security definer set search_path='' as $$
 declare w public.barbearias; b public.barbearia_cobrancas; payer public.usuarios; token uuid; today date:=(now() at time zone 'America/Sao_Paulo')::date;
 begin
  if not exists(select 1 from public.usuarios where id=p_actor and ativo and role='super_admin') then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
  select * into w from public.barbearias where id=p_workspace for update;
  if w.id is null then raise exception 'Barbearia inválida.' using errcode='42501'; end if;
  if exists(select 1 from public.billing_operations where barbearia_id=w.id and state in ('running','uncertain')) then raise exception 'Confira a operação existente antes de alterar os termos.' using errcode='23514'; end if;
  if p_plan is distinct from w.plano or p_amount is distinct from (case when w.plano='individual' then 5990 else 18999 end) then raise exception 'Plano ou valor divergente.' using errcode='23514'; end if;
  select * into payer from public.usuarios where id=w.owner_id and barbearia_id=w.id and ativo;
  if payer.id is null then raise exception 'Titular inválido.' using errcode='42501'; end if;
  select * into b from public.barbearia_cobrancas where barbearia_id=w.id for update;
  if b.state='creating' and b.started_at>now()-interval '90 seconds' then return jsonb_build_object('acquired',false); end if;
  if b.barbearia_id is null then
   if p_due is null or p_due<today or p_due>today+90 then raise exception 'Primeiro vencimento inválido.' using errcode='23514'; end if;
   insert into public.barbearia_cobrancas(barbearia_id,plan,amount_cents,first_due_date,customer_id,subscription_id,subscription_attempted)
   values(w.id,w.plano,p_amount,p_due,payer.asaas_customer_id,payer.subscription_id,payer.subscription_id is not null) returning * into b;
  elsif b.plan is distinct from w.plano or b.amount_cents<>p_amount or (b.first_due_date is distinct from p_due and b.subscription_id is null) then
   if b.subscription_attempted or (b.customer_attempted and b.customer_id is null) or b.subscription_id is not null then raise exception 'Confira a operação existente antes de alterar os termos.' using errcode='23514'; end if;
   if p_due is null or p_due<today or p_due>today+90 then raise exception 'Primeiro vencimento inválido.' using errcode='23514'; end if;
   update public.barbearia_cobrancas set plan=w.plano,amount_cents=p_amount,first_due_date=p_due where barbearia_id=w.id returning * into b;
  elsif b.subscription_id is null and not b.subscription_attempted and (p_due is null or p_due<today or p_due>today+90) then
   raise exception 'Primeiro vencimento inválido.' using errcode='23514';
  end if;
  token:=gen_random_uuid();
  update public.barbearia_cobrancas set state='creating',lease_token=token,started_at=now(),updated_at=now() where barbearia_id=w.id returning * into b;
  return jsonb_build_object('acquired',true,'lease',token,'billing',to_jsonb(b));
 end
$$;

revoke all on function private.link_billing_subscription(),private.guard_subscription_membership() from public,anon,authenticated;
revoke all on function public.apply_billing_snapshot(text,text,text,jsonb,timestamptz),public.billing_overview(uuid),public.claim_subscription_change(uuid,uuid,text,text,integer),public.finish_subscription_change(uuid,uuid,uuid,jsonb),public.fail_subscription_change(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.apply_billing_snapshot(text,text,text,jsonb,timestamptz),public.billing_overview(uuid),public.claim_subscription_change(uuid,uuid,text,text,integer),public.finish_subscription_change(uuid,uuid,uuid,jsonb),public.fail_subscription_change(uuid,uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';

create function public.reset_canceled_billing(p_actor uuid,p_workspace uuid,p_due date) returns void language plpgsql security definer set search_path='' as $$
 declare b public.barbearia_cobrancas; w public.barbearias;
 begin
  if not exists(select 1 from public.usuarios where id=p_actor and ativo and role='super_admin') then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
  select * into w from public.barbearias where id=p_workspace for update;
  select * into b from public.barbearia_cobrancas where barbearia_id=w.id for update;
  if b.subscription_status is distinct from 'DELETED' or exists(select 1 from public.billing_operations where barbearia_id=w.id and state in ('running','uncertain')) then raise exception 'Confirme o cancelamento antes de gerar nova assinatura.' using errcode='23514'; end if;
  if p_due<(now() at time zone 'America/Sao_Paulo')::date or p_due>(now() at time zone 'America/Sao_Paulo')::date+90 then raise exception 'Primeiro vencimento inválido.'; end if;
  update public.barbearia_cobrancas set request_id=gen_random_uuid(),state='none',plan=w.plano,amount_cents=case when w.plano='individual' then 5990 else 18999 end,
   first_due_date=p_due,subscription_id=null,subscription_status=null,subscription_observed_at=null,subscription_attempted=false,invoice_url=null,lease_token=null,updated_at=now() where barbearia_id=w.id;
  update public.usuarios set subscription_id=null,status_assinatura=null where id=w.owner_id;
 end
$$;
revoke all on function public.reset_canceled_billing(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.reset_canceled_billing(uuid,uuid,date) to service_role;
notify pgrst,'reload schema';

create table private.ops_job_locks(key text primary key,token uuid not null,expires_at timestamptz not null);
alter table private.ops_job_locks enable row level security;
create function public.claim_ops_job(p_key text,p_token uuid,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
 begin
  if p_key not in ('backup','smtp_test') or p_token is null then raise exception 'Job inválido.'; end if;
  insert into private.ops_job_locks(key,token,expires_at) values(p_key,p_token,now()+least(greatest(p_seconds,30),900)*interval '1 second')
  on conflict(key) do update set token=excluded.token,expires_at=excluded.expires_at where ops_job_locks.expires_at<now();
  return found;
 end
$$;
create function public.release_ops_job(p_key text,p_token uuid) returns void language sql security definer set search_path='' as $$delete from private.ops_job_locks where key=p_key and token=p_token$$;
revoke all on function public.claim_ops_job(text,uuid,integer),public.release_ops_job(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_ops_job(text,uuid,integer),public.release_ops_job(text,uuid) to service_role;
notify pgrst,'reload schema';
