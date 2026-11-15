import { withMonitoring } from '../_lib/monitoring.js';
import { getBillingContext, AccessError } from '../_lib/workspaces.js';
import { upsertAsaasCustomer } from '../_lib/asaas.js';

const DELAY_MS = 250; // spaces out calls to respect Asaas rate limits

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const { data: shops, error: shopError } = await supabase.from('barbearias').select('owner_id').eq('status', 'active');
  if (shopError) throw shopError;
  const ownerIds = (shops || []).map(w => w.owner_id).filter(Boolean);
  if (!ownerIds.length) return res.status(200).json({ total: 0, criados: 0, atualizados: 0, falharam: [] });
  const { data: barbeiros, error: fetchError } = await supabase
    .from('usuarios')
    .select('*')
    .in('role', ['dono', 'barbeiro']).in('id', ownerIds).eq('ativo', true);

  if (fetchError) {
    res.status(500).json({ error: fetchError.message });
    return;
  }

  const summary = { total: barbeiros.length, criados: 0, atualizados: 0, falharam: [] };

  for (const barbeiro of barbeiros) {
    try {
      const asaasCustomer = await upsertAsaasCustomer({
        id: barbeiro.id,
        nome: barbeiro.nome,
        email: barbeiro.email,
        cpf_cnpj: barbeiro.cpf_cnpj,
        telefone: barbeiro.telefone,
        asaas_customer_id: barbeiro.asaas_customer_id
      });

      const { error: updateError } = await supabase
        .from('usuarios')
        .update({ asaas_customer_id: asaasCustomer.id })
        .eq('id', barbeiro.id);

      if (updateError) throw updateError;

      if (barbeiro.asaas_customer_id) {
        summary.atualizados += 1;
      } else {
        summary.criados += 1;
      }
    } catch (err) {
      summary.falharam.push({ barberId: barbeiro.id, nome: barbeiro.nome, erro: err.message });
    }

    await sleep(DELAY_MS);
  }

  res.status(200).json(summary);
}

export default withMonitoring('asaas.sync-all', handler);
