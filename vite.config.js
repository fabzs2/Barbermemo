import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const release = env.VERCEL_GIT_COMMIT_SHA || env.SENTRY_RELEASE || 'local';
  const upload = Boolean(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT);
  return {
    define: {
      'import.meta.env.VITE_APP_RELEASE': JSON.stringify(release),
      'import.meta.env.VITE_APP_ENV': JSON.stringify(env.VERCEL_ENV || mode)
    },
    build: { sourcemap: upload ? 'hidden' : false },
    plugins: [react(), tailwindcss()]
  };
});
