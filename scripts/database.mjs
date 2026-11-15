import pg from 'pg';
export async function connectDatabase() {
  const urls=[process.env.POSTGRES_URL_NON_POOLING,process.env.POSTGRES_URL].filter(Boolean);
  if (!urls.length) return null;
  for (const value of [...new Set(urls)]) {
    const url=new URL(value);
    for(const key of ['sslmode','sslcert','sslkey','sslrootcert']) url.searchParams.delete(key);
    const client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:8000,statement_timeout:20000});
    try {await client.connect();return client;}
    catch {await client.end().catch(()=>{});}
  }
  throw new Error('Não foi possível conectar ao banco com TLS validado.');
}
