import { createHmac, timingSafeEqual } from 'node:crypto';
export function verifySignature(body, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export function alertText(payload) {
  const event = payload.data?.event || {};
  const tags = Object.fromEntries((Array.isArray(event.tags) ? event.tags : []).filter(x => Array.isArray(x)));
  const clean = value => String(value || 'não informado').replace(/[\r\n]/g, ' ').slice(0, 120);
  // Do not send raw exception messages, user data or request bodies to Telegram.
  const lines = ['🔴 Barbermemo — erro em produção',
    `Operação: ${clean(tags.operation)}`,
    `Tela: ${clean(tags.route)}`,
    `Versão: ${clean(event.release)}`,
    `Evento: ${clean(event.event_id)}`];
  try {
    const url = new URL(event.web_url);
    if (url.protocol === 'https:' && (url.hostname === 'sentry.io' || url.hostname.endsWith('.sentry.io'))) {
      lines.push(`Investigar: ${url.origin}${url.pathname}`);
    }
  } catch { /* A link is optional. */ }
  return lines.join('\n');
}
export async function deliverTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('Telegram não configurado');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(4000)
      });
      if (response.ok && (await response.json()).ok) return;
    } catch { /* Retry once, without logging the token-bearing request URL. */ }
  }
  throw new Error('Falha na entrega do alerta Telegram');
}
