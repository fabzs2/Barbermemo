import { getAuthedContext } from '../_lib/supabaseServer.js';
import { getSubscriptionsByCustomer, updateSubscriptionNextDueDate } from '../_lib/asaas.js';

const DEFAULT_TRIAL_DAYS = 7;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const ctx = await getAuthedContext(req);
  if (ctx.error) {
    res.status(401).json({ error: ctx.error });
    return;
  }
  const { supabase } = ctx;

  const barberId = req.body?.barberId;
  const trialDays = Number(req.body?.trialDays) || DEFAULT_TRIAL_DAYS;

  if (!barberId) {
    res.status(400).json({ error: 'barberId é obrigatório.' });
    return;
  }

  // Relies on the same RLS that already scopes db.adminSyncBarbeiroAsaas.
  const { data: barbeiro, error: fetchError } = await supabase
    .from('usuarios')
    .select('id, nome, asaas_customer_id')
    .eq('id', barberId)
    .eq('role', 'barbeiro')
    .maybeSingle();

  if (fetchError) {
    res.status(500).json({ error: fetchError.message });
    return;
  }
  if (!barbeiro) {
    res.status(404).json({ error: 'Barbeiro não encontrado ou sem permissão de acesso.' });
    return;
  }
  if (!barbeiro.asaas_customer_id) {
    res.status(422).json({ error: 'Barbeiro ainda não está sincronizado com o Asaas.' });
    return;
  }

  try {
    const subscriptions = await getSubscriptionsByCustomer(barbeiro.asaas_customer_id);
    const active = subscriptions.filter((s) => s.status === 'ACTIVE');

    if (active.length === 0) {
      res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada para este barbeiro no Asaas.' });
      return;
    }

    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + trialDays);
    const nextDueDateStr = nextDueDate.toISOString().split('T')[0];

    const updated = [];
    for (const sub of active) {
      updated.push(await updateSubscriptionNextDueDate(sub.id, nextDueDateStr));
    }

    res.status(200).json({ barbeiro: barbeiro.nome, nextDueDate: nextDueDateStr, subscriptions: updated });
  } catch (err) {
    res.status(err.status && err.status < 500 ? 422 : 502).json({ error: err.message });
  }
}
