import * as Sentry from '@sentry/node';
import { sanitizeEvent } from '../../monitoring/privacy.js';
Sentry.init({
  dsn: process.env.SENTRY_DSN, enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.VERCEL_ENV || 'development',
  release: process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE,
  sendDefaultPii: false, defaultIntegrations: false,
  beforeSend: sanitizeEvent, tracesSampleRate: 0
});
export function reportServerError(operation) {
  if (process.env.SENTRY_DSN) Sentry.captureException(new Error(`Falha na operação: ${operation}`), {tags:{ operation, source:'api' }});
}
export function withMonitoring(operation, handler) {
  return async (req, res) => {
    let reported = false;
    const originalJson = res.json.bind(res);
    res.json = body => {
      // Includes partial failures returned with HTTP 200 by the batch endpoint.
      if (res.statusCode >= 500 || body?.falharam?.length) { reported = true; reportServerError(operation); }
      return originalJson(body);
    };
    try { return await handler(req, res); }
    catch {
      if (!reported) reportServerError(operation);
      if (!res.headersSent) return res.status(500).json({error:'Não foi possível concluir a operação.'});
    } finally { if (process.env.SENTRY_DSN) await Sentry.flush(1500); }
  };
}
