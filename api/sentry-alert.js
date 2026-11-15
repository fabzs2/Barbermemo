import { waitUntil } from '@vercel/functions';
import { verifySignature, alertText, deliverTelegram } from './_lib/sentryWebhook.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Método não permitido'});
  const secret = process.env.SENTRY_WEBHOOK_SECRET;
  if (!secret || !process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return res.status(503).json({error:'Alertas não configurados'});
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 256 * 1024) return res.status(413).end();
      chunks.push(buffer);
    }
  } catch { return res.status(400).end(); }
  const raw = Buffer.concat(chunks);
  if (!verifySignature(raw, req.headers['sentry-hook-signature'], secret)) return res.status(401).end();
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).end(); }
  if (req.headers['sentry-hook-resource'] !== 'event_alert' || payload.action !== 'triggered') return res.status(204).end();
  // Keep the webhook fast; Vercel waits for this background task after the response.
  waitUntil(deliverTelegram(alertText(payload)).then(() => {
    console.info('monitoring.telegram_delivery_succeeded');
  }).catch(() => {
    console.error('monitoring.telegram_delivery_failed');
  }));
  return res.status(202).json({accepted:true});
}
