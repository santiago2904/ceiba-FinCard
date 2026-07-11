import { existsSync } from 'node:fs';
import { loadEnv } from './config/env.js';
import { buildContainer } from './config/container.js';
import { runMigrations } from './adapters/out/postgres/migrate.js';

// Load a local .env when present (dev). No-op in containers/prod, where env
// vars come from the task definition. Requires Node >= 20.12 (process.loadEnvFile).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

async function bootstrap() {
  const config = loadEnv();
  const { app, db } = buildContainer(config);
  await runMigrations(db, 'migrations/001_init.sql');
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
