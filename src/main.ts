import { loadEnv } from './config/env.js';
import { buildContainer } from './config/container.js';
import { runMigrations } from './adapters/out/postgres/migrate.js';

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
