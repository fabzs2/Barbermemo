import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { SentryCli } from '@sentry/cli';

export async function removeMaps(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await removeMaps(path);
    else if (entry.name.endsWith('.map')) await unlink(path);
  }
}
if (process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) {
  // Run after Vite has finished writing the final assets, so uploaded code and served code match.
  process.env.SENTRY_RELEASE ||= process.env.VERCEL_GIT_COMMIT_SHA || '';
  const cli = new SentryCli();
  await cli.execute(['sourcemaps', 'inject', 'dist'], true);
  await cli.execute(['sourcemaps', 'upload', 'dist'], true);
  await removeMaps('dist');
  console.log('Source maps enviados ao Sentry e removidos dos arquivos públicos.');
} else {
  // Never publish maps if only part of the upload configuration was supplied.
  await removeMaps('dist');
  console.log('Upload de source maps não configurado.');
}
