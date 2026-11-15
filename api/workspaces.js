import {activateWorkspaceBilling,payerInput,invoiceForSubscription} from './_lib/billing.js';
import {asaasFetch,asaasEnvironment} from './_lib/asaas.js';
import { withMonitoring } from './_lib/monitoring.js';
import { AccessError, accountInput, workspaceInput, authorizeWorkspace, requireSuperAdmin, unwrap, getManagementContext, provisionAccount } from './_lib/workspaces.js';

export function createWorkspaceHandler(context = getManagementContext, provider = asaasFetch) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método não permitido.' });
    try {
      const { actor, admin } = await context(req);
      if (req.method === 'GET') {
        let query = admin.from('barbearias').select('*').order('created_at', { ascending: false });
        if (actor.role !== 'super_admin') query = query.eq('id', actor.barbearia_id);
        const workspaces = unwrap(await query);
        const workspaceId = req.query?.workspaceId || workspaces[0]?.id;
        const selected = workspaces.find(w => w.id === workspaceId);
        if (workspaceId && !selected) throw new AccessError('Barbearia não encontrada.', 404);
        if (selected) authorizeWorkspace(actor, selected);
        const members = selected ? unwrap(await admin.from('usuarios').select('id,nome,email,role,ativo,telefone,created_at').eq('barbearia_id', selected.id).order('created_at')) : [];
        const counts = selected ? await Promise.all(['clientes', 'atendimentos', 'agendamentos'].map(table => admin.from(table).select('id', { count: 'exact', head: true }).eq('barbearia_id', selected.id))) : [];
        counts.forEach(unwrap);
        let billing=null,payer=null;
        if(selected) {
          const row=unwrap(await admin.from('barbearia_cobrancas').select('state,plan,amount_cents,first_due_date,subscription_id,subscription_attempted,invoice_url').eq('barbearia_id',selected.id).maybeSingle());
          billing=row;
          if(actor.role==='super_admin') payer=unwrap(await admin.from('usuarios').select('id,nome,email,cpf_cnpj,telefone').eq('id',selected.owner_id).maybeSingle());
        }
        return res.status(200).json({ workspaces, selected, members, billing, payer, billingEnvironment:asaasEnvironment(), stats: { clientes: counts[0]?.count || 0, atendimentos: counts[1]?.count || 0, agendamentos: counts[2]?.count || 0 } });
      }
      const body = req.body || {};
      if (body.action === 'create_workspace') {
        requireSuperAdmin(actor);
        const input = {...accountInput(body),...payerInput(body)};
        const values = workspaceInput(body);
        const workspace = unwrap(await admin.from('barbearias').insert({ ...values, status: 'pilot' }).select().single());
        try {
          const member = await provisionAccount(admin, actor, workspace, input, values.plano === 'barbearia' ? 'dono' : 'barbeiro');
          return res.status(201).json({ workspaceId: workspace.id, member });
        } catch (error) {
          // Only an empty workspace can be removed; foreign keys protect existing accounts and data.
          const cleanup = await admin.from('barbearias').delete().eq('id', workspace.id).is('owner_id', null);
          if (cleanup.error) console.error('workspace.empty_cleanup_failed');
          throw error;
        }
      }
      if (!/^[0-9a-f-]{36}$/i.test(body.workspaceId || '')) throw new AccessError('Selecione uma barbearia válida.');
      const workspace = unwrap(await admin.from('barbearias').select('*').eq('id', body.workspaceId).maybeSingle());
      authorizeWorkspace(actor, workspace);
      if (body.action === 'add_barber') {
        if (workspace.plano !== 'barbearia') throw new AccessError('O plano individual permite somente o titular.', 409);
        const member = await provisionAccount(admin, actor, workspace, accountInput(body), 'barbeiro');
        return res.status(201).json({ member });
      }
      if (body.action === 'update_workspace') {
        requireSuperAdmin(actor);
        const values = workspaceInput(body);
        unwrap(await admin.from('barbearias').update(values).eq('id', workspace.id));
        return res.status(200).json({ ok: true });
      }
      if (body.action === 'activate_billing') {
        return res.status(200).json(await activateWorkspaceBilling({admin,actor,workspace,body,provider}));
      }
      if (body.action === 'refresh_billing_link') {
        requireSuperAdmin(actor);
        const billing=unwrap(await admin.from('barbearia_cobrancas').select('*').eq('barbearia_id',workspace.id).maybeSingle());
        if(!billing?.subscription_id)throw new AccessError('A assinatura ainda não foi confirmada.',409);
        const invoiceUrl=await invoiceForSubscription(provider,billing.subscription_id);
        if(invoiceUrl)unwrap(await admin.rpc('progress_workspace_billing',{p_actor:actor.id,p_workspace:workspace.id,p_lease:billing.lease_token,p_action:'invoice',p_values:{invoice_url:invoiceUrl}}));
        return res.status(200).json({invoiceUrl});
      }
      if (body.action === 'set_workspace_status') {
        requireSuperAdmin(actor);
        if(body.status==='active')throw new AccessError('Use Ativar e gerar assinatura para confirmar a cobrança.',409);
        if (!['pilot', 'suspended'].includes(body.status)) throw new AccessError('Status inválido.');
        unwrap(await admin.from('barbearias').update({ status: body.status }).eq('id', workspace.id));
        return res.status(200).json({ ok: true });
      }
      if (body.action === 'set_member_active') {
        if (typeof body.ativo !== 'boolean') throw new AccessError('Status de acesso inválido.');
        const member = unwrap(await admin.from('usuarios').select('id,role').eq('id', body.memberId).eq('barbearia_id', workspace.id).maybeSingle());
        if (!member || member.id === workspace.owner_id || member.role !== 'barbeiro') throw new AccessError('O titular é gerenciado pelo status da barbearia.', 403);
        if (workspace.status === 'suspended') throw new AccessError('Reative a barbearia antes de alterar os acessos.', 409);
        unwrap(await admin.from('usuarios').update({ ativo: body.ativo }).eq('id', member.id).eq('barbearia_id', workspace.id));
        return res.status(200).json({ ok: true });
      }
      throw new AccessError('Operação desconhecida.');
    } catch (error) {
      if (error instanceof AccessError) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  };
}
export default withMonitoring('workspaces.manage', createWorkspaceHandler());
