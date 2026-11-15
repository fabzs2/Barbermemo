import * as Sentry from '@sentry/react';
import { safeRoute, sanitizeEvent } from '../../monitoring/privacy.js';

export const monitoringEnabled = Boolean(import.meta.env.VITE_SENTRY_DSN) &&
  (import.meta.env.PROD || import.meta.env.VITE_MONITORING_ENABLED === 'true');

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || undefined,
  enabled: monitoringEnabled,
  environment: import.meta.env.VITE_APP_ENV || import.meta.env.MODE,
  release: import.meta.env.VITE_APP_RELEASE || undefined,
  sendDefaultPii: false,
  // No session recording, click breadcrumbs, console data or network bodies.
  integrations: defaults => defaults.filter(item => !['Breadcrumbs', 'HttpContext', 'BrowserSession'].includes(item.name)),
  beforeSend: sanitizeEvent,
  maxBreadcrumbs: 0,
  tracesSampleRate: 0
});

export function reportOperation(error, operation) {
  if (!monitoringEnabled || ['invalid_credentials', 'email_not_confirmed', 'weak_password'].includes(error?.code)) return;
  const diagnostic = new Error(`Falha na operação: ${operation}`);
  if (typeof error?.stack === 'string') {
    diagnostic.stack = `${diagnostic.name}: ${diagnostic.message}\n${error.stack.split('\n').slice(1).join('\n')}`;
  }
  Sentry.captureException(diagnostic, { tags: {
    operation, route: safeRoute(window.location.pathname),
    error_code: /^[\w-]{1,40}$/.test(String(error?.code)) ? String(error.code) : 'unknown'
  } });
}

export function instrumentOperations(operations) {
  return Object.fromEntries(Object.entries(operations).map(([name, action]) => [name, async (...args) => {
    try { return await action(...args); }
    catch (error) { reportOperation(error, name); throw error; }
  }]));
}
export { Sentry };
