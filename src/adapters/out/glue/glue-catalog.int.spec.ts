import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { GlueClient, GetDatabaseCommand, GetTableCommand } from '@aws-sdk/client-glue';
import { GlueCatalog } from './glue-catalog.js';

// Glue is a LocalStack Pro feature (community LocalStack returns "API for service
// 'glue' not yet implemented or pro feature"), so this suite is skipped by default.
// RF-03 is exercised locally via FileDataCatalog instead (see
// src/adapters/out/catalog/file-data-catalog.spec.ts). To run this suite against
// LocalStack Pro or real AWS Glue, set RUN_GLUE_IT=1: `RUN_GLUE_IT=1 npm run test:int`.
describe.skipIf(!process.env.RUN_GLUE_IT)('GlueCatalog', () => {
  let ls: StartedTestContainer; let endpoint: string;
  beforeAll(async () => {
    ls = await new GenericContainer('localstack/localstack:3').withEnvironment({ SERVICES: 'glue' }).withExposedPorts(4566).start();
    endpoint = `http://${ls.getHost()}:${ls.getMappedPort(4566)}`;
  }, 120_000);
  afterAll(async () => { await ls.stop(); });

  it('ensures database and upserts table idempotently', async () => {
    const cat = new GlueCatalog({ region: 'us-east-1', endpoint });
    await cat.ensureDatabase('fincard_loyalty');
    await cat.ensureDatabase('fincard_loyalty'); // idempotent
    await cat.upsertTable('fincard_loyalty', 'transactions', [
      { name: 'transaction_id', type: 'string' }, { name: 'points_earned', type: 'int' },
    ]);
    await cat.upsertTable('fincard_loyalty', 'transactions', [
      { name: 'transaction_id', type: 'string' }, { name: 'points_earned', type: 'int' },
    ]); // update path
    const client = new GlueClient({ region: 'us-east-1', endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
    await expect(client.send(new GetDatabaseCommand({ Name: 'fincard_loyalty' }))).resolves.toBeTruthy();
    const t = await client.send(new GetTableCommand({ DatabaseName: 'fincard_loyalty', Name: 'transactions' }));
    expect(t.Table?.Name).toBe('transactions');
  });
});
