export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ status: 'method_not_allowed' });
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) return res.status(503).json({ status: 'unavailable', checks: { configuration: false } });
  // Read-only, uses the public key and RLS; never returns customer rows.
  const checks = await Promise.allSettled([
    fetch(`${base.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(4000) }),
    fetch(`${base.replace(/\/$/, '')}/rest/v1/clientes?select=id&limit=0`, { headers: { apikey: key }, signal: AbortSignal.timeout(4000) })
  ]);
  const auth = checks[0].status === 'fulfilled' && checks[0].value.ok;
  const database = checks[1].status === 'fulfilled' && checks[1].value.ok;
  return res.status(auth && database ? 200 : 503).json({ status: auth && database ? 'ok' : 'unavailable', checks: { auth, database } });
}
