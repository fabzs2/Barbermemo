-- Server-owned billing ledger; no customer charge is created by this migration.
create table public.barbearia_cobrancas (
 barbearia_id uuid primary key references public.barbearias(id) on delete cascade,
 request_id uuid not null default gen_random_uuid() unique,
 state text not null default 'none' check(state in ('none','creating','ready','uncertain','error')),
 plan text not null check(plan in ('individual','barbearia')),
 amount_cents integer not null check(amount_cents in (5990,18999)),
 first_due_date date not null,
 customer_id text, subscription_id text unique, invoice_url text,
 customer_attempted boolean not null default false, subscription_attempted boolean not null default false,
 lease_token uuid, started_at timestamptz, updated_at timestamptz not null default now()
);
alter table public.barbearia_cobrancas enable row level security;
revoke all on public.barbearia_cobrancas from public,anon,authenticated;
grant select on public.barbearia_cobrancas to authenticated;
grant all on public.barbearia_cobrancas to service_role;
create policy billing_super_read on public.barbearia_cobrancas for select to authenticated using(private.is_super_admin());

create function private.guard_billing_identity() returns trigger language plpgsql security definer set search_path='' as $$
 declare jwt_role text:=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role';
 begin
  if new.cpf_cnpj is distinct from old.cpf_cnpj and coalesce(jwt_role,'')<>'service_role' and not(jwt_role is null and session_user in ('postgres','supabase_admin')) then
   raise exception 'Dados de cobrança são alterados pela administração.' using errcode='42501';
  end if;
  return new;
 end
$$;
create trigger guard_billing_identity before update of cpf_cnpj on public.usuarios for each row execute function private.guard_billing_identity();
create function private.guard_billing_workspace() returns trigger language plpgsql security definer set search_path='' as $$
 declare b public.barbearia_cobrancas;
 begin
  select * into b from public.barbearia_cobrancas where barbearia_id=old.id;
  if b.state='creating' and b.started_at>now()-interval '90 seconds' and (new.plano is distinct from old.plano or new.status is distinct from old.status or new.owner_id is distinct from old.owner_id) then
   -- Completion sets the ledger ready first, in the same transaction.
   raise exception 'Aguarde a ativação em andamento.' using errcode='23514';
  end if;
  if new.plano is distinct from old.plano and (b.subscription_id is not null or b.subscription_attempted) then
   raise exception 'Revise a assinatura no Asaas antes de mudar o plano.' using errcode='23514';
  end if;
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
create trigger guard_billing_workspace before update on public.barbearias for each row execute function private.guard_billing_workspace();

create function public.begin_workspace_billing(p_actor uuid,p_workspace uuid,p_plan text,p_amount integer,p_due date) returns jsonb language plpgsql security definer set search_path='' as $$
 declare w public.barbearias; b public.barbearia_cobrancas; payer public.usuarios; token uuid; today date:=(now() at time zone 'America/Sao_Paulo')::date;
 begin
  if not exists(select 1 from public.usuarios where id=p_actor and ativo and role='super_admin') then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
  select * into w from public.barbearias where id=p_workspace for update;
  if w.id is null then raise exception 'Barbearia inválida.' using errcode='42501'; end if;
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
create function public.progress_workspace_billing(p_actor uuid,p_workspace uuid,p_lease uuid,p_action text,p_values jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
 declare b public.barbearia_cobrancas; w public.barbearias;
 begin
  if not exists(select 1 from public.usuarios where id=p_actor and ativo and role='super_admin') then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
  select * into w from public.barbearias where id=p_workspace for update;
  select * into b from public.barbearia_cobrancas where barbearia_id=p_workspace and lease_token=p_lease for update;
  if b.barbearia_id is null or b.plan is distinct from w.plano then raise exception 'Operação de cobrança desatualizada.' using errcode='42501'; end if;
  if p_action='customer_attempt' then
   if b.customer_attempted or b.customer_id is not null then raise exception 'Cadastro já solicitado.' using errcode='23514'; end if;
   b.customer_attempted:=true;
  elsif p_action='customer_saved' then
   if coalesce(p_values->>'customer_id','')!~'^cus_[A-Za-z0-9]+$' then raise exception 'Cliente Asaas inválido.'; end if;
   b.customer_id:=p_values->>'customer_id';
  elsif p_action='subscription_attempt' then
   if b.subscription_attempted or b.subscription_id is not null or b.customer_id is null then raise exception 'Assinatura já solicitada ou cliente ausente.' using errcode='23514'; end if;
   b.subscription_attempted:=true;
  elsif p_action='complete' then
   if coalesce(p_values->>'subscription_id','')!~'^sub_[A-Za-z0-9]+$' or b.customer_id is null or p_values->>'customer_id' is distinct from b.customer_id then raise exception 'Assinatura Asaas inválida.'; end if;
   b.subscription_id:=p_values->>'subscription_id';b.subscription_attempted:=true;b.state:='ready';
  elsif p_action='invoice' then
   if b.state<>'ready' or coalesce(p_values->>'invoice_url','')!~'^https://([a-z0-9-]+\.)*asaas\.com/' then raise exception 'Link de cobrança inválido.'; end if;
   b.invoice_url:=p_values->>'invoice_url';
  elsif p_action='rejected' then
   b.state:='error';
   if p_values->>'stage'='customer_post' then b.customer_attempted:=false; end if;
   if p_values->>'stage'='subscription_post' then b.subscription_attempted:=false; end if;
  elsif p_action='uncertain' then b.state:='uncertain';
  else raise exception 'Etapa inválida.'; end if;
  update public.barbearia_cobrancas set customer_id=b.customer_id,subscription_id=b.subscription_id,invoice_url=b.invoice_url,customer_attempted=b.customer_attempted,subscription_attempted=b.subscription_attempted,state=b.state,updated_at=now() where barbearia_id=w.id;
  if p_action='complete' then
   update public.usuarios set asaas_customer_id=b.customer_id,subscription_id=b.subscription_id,status_assinatura='ACTIVE' where id=w.owner_id;
   update public.barbearias set status='active' where id=w.id;
  end if;
  return to_jsonb(b);
 end
$$;
revoke all on function private.guard_billing_identity(),private.guard_billing_workspace() from public,anon,authenticated;
revoke all on function public.begin_workspace_billing(uuid,uuid,text,integer,date),public.progress_workspace_billing(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_workspace_billing(uuid,uuid,text,integer,date),public.progress_workspace_billing(uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
