// Export only diagnostic fields. Never forward request bodies, account data or breadcrumbs.
export function safeRoute(path = '/') {
  return path.split('?')[0].split('#')[0]
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':id')
    .replace(/\b\d+\b/g, ':id');
}
export function scrubText(value = '') {
  return String(value)
    .replace(/https?:\/\/[^\s)]+/g, '[url]')
    .replace(/(?:sb_secret_|sb_publishable_|eyJ)[\w.-]+/g, '[credential]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/(['"`]).*?\1/g, '[value]')
    .replace(/\+?\d[\d ().-]{7,}\d/g, '[number]')
    .slice(0, 500);
}
export function sanitizeEvent(event) {
  const tags = {};
  for (const key of ['operation', 'route', 'error_code', 'source']) {
    if (event.tags?.[key]) tags[key] = scrubText(event.tags[key]);
  }
  return {
    event_id: event.event_id, timestamp: event.timestamp,
    platform: event.platform, level: event.level,
    environment: event.environment, release: event.release,
    exception: event.exception && { values: event.exception.values?.map(value => ({
      type: scrubText(value.type), value: scrubText(value.value), mechanism: value.mechanism && {
        type: value.mechanism.type, handled: value.mechanism.handled
      },
      stacktrace: value.stacktrace && { frames: value.stacktrace.frames?.map(frame => ({
        filename: frame.filename?.split('?')[0].split('#')[0],
        abs_path: frame.abs_path?.split('?')[0].split('#')[0],
        function: frame.function, module: frame.module,
        lineno: frame.lineno, colno: frame.colno, in_app: frame.in_app,
        debug_id: frame.debug_id
      })) }
    })) },
    message: event.message ? scrubText(event.message) : undefined,
    tags, debug_meta: event.debug_meta
  };
}
