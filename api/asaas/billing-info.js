import { getAsaasSubscription, getAsaasSubscriptionPayments } from '../_lib/asaas.js';
import { getAuthedContext } from '../_lib/supabaseServer.js';

export default async function handler(req, res) {
  // 1. Get authenticated context of the current logged-in user
  const { supabase, user, error } = await getAuthedContext(req);
  if (error || !user) {
    return res.status(401).json({ error: error || 'Sessão inválida ou expirada.' });
  }

  try {
    // 2. Fetch user's subscription details from database
    const { data: dbUser, error: dbError } = await supabase
      .from('usuarios')
      .select('subscription_id, plano, status_assinatura')
      .eq('id', user.id)
      .maybeSingle();

    if (dbError || !dbUser) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const subscriptionId = dbUser.subscription_id;

    if (!subscriptionId) {
      return res.status(200).json({ 
        hasSubscription: false,
        plano: dbUser.plano,
        status: dbUser.status_assinatura || 'INACTIVE'
      });
    }

    // 3. Query Asaas API
    const subscription = await getAsaasSubscription(subscriptionId);
    const paymentsData = await getAsaasSubscriptionPayments(subscriptionId);
    const payments = paymentsData.data || [];

    // Find the latest payment to retrieve its invoice URL
    const latestPayment = payments[0] || null;

    res.status(200).json({
      hasSubscription: true,
      plano: dbUser.plano,
      status: subscription.status,
      value: subscription.value,
      nextDueDate: subscription.nextDueDate,
      billingType: subscription.billingType,
      invoiceUrl: latestPayment?.invoiceUrl || null,
      bankSlipUrl: latestPayment?.bankSlipUrl || null,
      pixQrCodeUrl: latestPayment?.pixQrCodeUrl || null
    });

  } catch (err) {
    console.error('Erro ao buscar dados de faturamento Asaas:', err);
    res.status(500).json({ error: err.message || 'Erro ao buscar dados de faturamento.' });
  }
}
