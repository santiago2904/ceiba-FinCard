import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileDataCatalog } from './file-data-catalog.js';

describe('FileDataCatalog', () => {
  const filePath = join(tmpdir(), `fincard-catalog-${randomUUID()}.json`);

  afterEach(async () => {
    await rm(filePath, { force: true });
  });

  it('ensureDatabase is idempotent and creates the db entry', async () => {
    const cat = new FileDataCatalog(filePath);
    await cat.ensureDatabase('fincard_loyalty');
    await cat.ensureDatabase('fincard_loyalty');

    const raw = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(Object.keys(raw.databases)).toEqual(['fincard_loyalty']);
    expect(raw.databases.fincard_loyalty.tables).toEqual({});
  });

  it('upsertTable creates a table then updates its columns, creating the db if missing', async () => {
    const cat = new FileDataCatalog(filePath);
    await cat.upsertTable('fincard_loyalty', 'transactions', [
      { name: 'transaction_id', type: 'string' },
      { name: 'points_earned', type: 'int' },
    ]);

    let raw = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(raw.databases.fincard_loyalty.tables.transactions.columns).toEqual([
      { name: 'transaction_id', type: 'string' },
      { name: 'points_earned', type: 'int' },
    ]);

    await cat.upsertTable('fincard_loyalty', 'transactions', [
      { name: 'transaction_id', type: 'string' },
      { name: 'points_earned', type: 'int' },
      { name: 'points_redeemed', type: 'int' },
    ]);

    raw = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(raw.databases.fincard_loyalty.tables.transactions.columns).toEqual([
      { name: 'transaction_id', type: 'string' },
      { name: 'points_earned', type: 'int' },
      { name: 'points_redeemed', type: 'int' },
    ]);
  });
});
