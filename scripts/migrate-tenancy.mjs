import { readFile } from 'node:fs/promises';
import { connectDatabase } from './database.mjs';
import { verifyTenancy } from './verify-tenancy.mjs';

const version = '20261115_workspaces';
if (process.env.VERCEL_ENV !== 'production') {
  console.log('Production tenant migration skipped outside the production build.');
} else {
  const client = await connectDatabase();
  if (!client) throw new Error('Production database connection is required for tenant migration.');
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtextextended('barbermemo-schema-migration',0))");
    const exists = (await client.query("select to_regclass('private.schema_migrations') is not null as ready")).rows[0].ready;
    const applied = exists && (await client.query('select 1 from private.schema_migrations where version=$1', [version])).rowCount > 0;
    if (!applied) {
      const sql = await readFile(new URL('../supabase/migrations/20261115_workspaces.sql', import.meta.url), 'utf8');
      await client.query(sql);
    }
    await verifyTenancy(client);
    if (!applied) await client.query('insert into private.schema_migrations(version) values($1)', [version]);
    if (process.env.TENANCY_MIGRATION_DRY_RUN === '1') {
      await client.query('rollback');
      console.log('Tenant migration validated and rolled back (dry run).');
    } else {
      await client.query('commit');
      console.log(applied ? 'Tenant schema current; isolation verified.' : 'Tenant migration applied; original customer records preserved.');
    }
  } catch (error) {
    await client.query('rollback').catch(() => {});
    console.error('Tenant migration aborted and rolled back:', error.code || error.name, error.message, error.position || '');
    process.exitCode = 1;
  } finally { await client.end(); }
}
