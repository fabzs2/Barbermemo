import { withMonitoring } from '../_lib/monitoring.js';
import { getBillingContext, AccessError } from '../_lib/workspaces.js';
import { upsertAsaasCustomer } from '../_lib/asaas.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  let ctx;
  try { ctx = await getBillingContext(req); }
  catch (error) {
    if (error instanceof AccessError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  const { supabase } = ctx;

  const barberId = req.body?.barberId;
  if (!barberId) return res.status(400).json({ error: 'Informe o titular.' });

  const { data: barbeiro, error: fetchError } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', barberId)
    .in('role', ['dono', 'barbeiro'])
    .maybeSingle();

  if (fetchError) {
    res.status(500).json({ error: fetchError.message });
    return;
  }
  if (!barbeiro) {
    res.status(404).json({ error: 'Barbeiro não encontrado ou sem permissão de acesso.' });
    return;
  }

  const { data: workspace, error: workspaceError } = await supabase.from('barbearias').select('id').eq('owner_id', barberId).eq('status', 'active').maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace) return res.status(409).json({ error: 'Somente titulares de planos ativos podem ser sincronizados com o Asaas. Contas piloto e membros da equipe não são cobrados por aqui.' });

  try {
    const asaasCustomer = await upsertAsaasCustomer({
      id: barbeiro.id,
      nome: barbeiro.nome,
      email: barbeiro.email,
      cpf_cnpj: barbeiro.cpf_cnpj,
      telefone: barbeiro.telefone,
      asaas_customer_id: barbeiro.asaas_customer_id
    });

    const { data: updated, error: updateError } = await supabase
      .from('usuarios')
      .update({ asaas_customer_id: asaasCustomer.id })
      .eq('id', barberId)
      .select()
      .single();

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    res.status(200).json({ barbeiro: updated, asaasCustomer });
  } catch (err) {
    res.status(err.status && err.status < 500 ? 422 : 502).json({ error: err.message });
  }
}

export default withMonitoring('asaas.sync-customer', handler);
