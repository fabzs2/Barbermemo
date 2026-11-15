import test from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD_RECOVERY_URL, requestPasswordRecovery } from '../src/auth/recovery.js';

test('password recovery uses the public domain even when initiated from a protected deployment', async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: 'https://barbermemo-protected-deployment.vercel.app' } };
  try {
    let request;
    const client = { auth: { resetPasswordForEmail: async (email, options) => { request = { email, options }; return { error: null }; } } };
    await requestPasswordRecovery(client, ' Cliente@Example.com ');
    assert.deepEqual(request, { email: 'cliente@example.com', options: { redirectTo: 'https://www.barbermemo.com.br/redefinir-senha' } });
    assert.equal(new URL(PASSWORD_RECOVERY_URL).hostname, 'www.barbermemo.com.br');
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('password recovery propagates provider failure so the UI does not show false success', async () => {
  const error = new Error('Provider unavailable');
  await assert.rejects(requestPasswordRecovery({auth:{resetPasswordForEmail:async()=>({error})}}, 'cliente@example.com'), error);
});
