import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PASSWORD_RECOVERY_URL } from '../src/auth/recovery.js';

// Verifies GoTrue's real redirect allowlist using a disposable account, without
// sending email or touching a real user's password or recovery link.
export async function verifyRecovery() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || !anon) throw new Error('Server credentials required for recovery verification.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, key, options);
  const email = `recovery-qa-${randomUUID()}@example.invalid`;
  const password = 'Qa1!' + randomBytes(24).toString('base64url');
  let userId;
  try {
    const account = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome: 'Recovery verification' } });
    if (account.error || !account.data?.user?.id) throw new Error('Temporary recovery account could not be created.');
    userId = account.data.user.id;
    const generated = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: PASSWORD_RECOVERY_URL } });
    if (generated.error || !generated.data.properties?.action_link) throw new Error('Recovery link generation failed.');
    const link = new URL(generated.data.properties.action_link);
    if (link.origin !== new URL(url).origin) throw new Error('Unexpected recovery verification host.');
    // Do not print URLs: they contain disposable credentials and access tokens.
    const verified = await fetch(link, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const location = verified.headers.get('location');
    if (!location) throw new Error('Recovery token verification did not redirect.');
    const target = new URL(location);
    console.log('Recovery destination:', target.origin + target.pathname);
    if (target.origin + target.pathname !== PASSWORD_RECOVERY_URL) throw new Error('Supabase recovery redirect allowlist must include the public reset URL.');
    const fragment = new URLSearchParams(target.hash.slice(1));
    if (!fragment.get('access_token') || fragment.get('type') !== 'recovery') throw new Error('Recovery session was not issued.');
    const publicPage = await fetch(PASSWORD_RECOVERY_URL, { signal: AbortSignal.timeout(15000) });
    if (publicPage.status !== 200 || !new URL(publicPage.url).hostname.endsWith('barbermemo.com.br')) throw new Error('Public recovery page is not accessible without Vercel authentication.');
    const client = createClient(url, anon, options);
    const session = await client.auth.setSession({ access_token: fragment.get('access_token'), refresh_token: fragment.get('refresh_token') });
    if (session.error) throw new Error('Recovery session could not be consumed.');
    const changed = await client.auth.updateUser({ password: 'New1!' + randomBytes(24).toString('base64url') });
    if (changed.error) throw new Error('Password change with the recovery session failed.');
    await client.auth.signOut();
    console.log('Recovery verified: public domain, no Vercel session, recovery token and temporary password update.');
  } finally {
    if (userId) {
      const cleanup = await admin.auth.admin.deleteUser(userId);
      if (cleanup.error) throw new Error('Temporary recovery account cleanup failed.');
    }
  }
}
if (process.env.VERCEL_ENV === 'production') await verifyRecovery();
