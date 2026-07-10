import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb } from './db.js';
import { runMigrations } from './migrate.js';
import { PostgresTransactionRepository } from './transaction.repository.js';
import { PostgresPartnerRepository } from './partner.repository.js';
import type { Kysely } from 'kysely';
import type { DB } from './db.js';

let container: StartedPostgreSqlContainer;
let db: Kysely<DB>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = createDb(container.getConnectionUri());
  await runMigrations(db, 'migrations/001_init.sql');
}, 120_000);
afterAll(async () => {
  await db.destroy();
  await container.stop();
});

describe('PostgresTransactionRepository', () => {
  it('saves and queries transactions for settlement', async () => {
    const repo = new PostgresTransactionRepository(db);
    await repo.saveMany(
      [
        {
          transactionId: 'TXN001',
          memberId: 'MEM001',
          partnerId: 'PART01',
          pointsEarned: 150,
          pointsRedeemed: 0,
          transactionDate: '2026-07-01',
          partnerName: 'Café Central',
        },
      ],
      { batchId: 'b1', processedAt: '2026-07-09T00:00:00.000Z' },
    );
    const found = await repo.findForSettlement('PART01', '2026-07-01', '2026-07-31');
    expect(found).toHaveLength(1);
    expect(found[0]!.pointsEarned).toBe(150);
  });
  it('resolves partner name from seed', async () => {
    const partners = new PostgresPartnerRepository(db);
    expect(await partners.findName('PART01')).toBe('Café Central');
    expect(await partners.findName('PART99')).toBeNull();
  });
});
