import { describe, it, expect } from 'vitest';
import { UploadTransactionsService } from './upload-transactions.service.js';
import { FakeStorage, FakeCatalog, FakeRepo } from '../../../test/fakes/index.js';

const CSV = `transaction_id,member_id,partner_id,points_earned,points_redeemed,transaction_date,partner_name
TXN001,MEM001,PART01,150,0,2026-07-01,Café Central
TXN002,MEMX1,PART01,10,0,2026-07-01,Café Central`;

describe('UploadTransactionsService', () => {
  it('stores valid rows, records errors, catalogs, and persists', async () => {
    const storage = new FakeStorage(); const catalog = new FakeCatalog(); const repo = new FakeRepo();
    const svc = new UploadTransactionsService(storage, catalog, repo, () => new Date('2026-07-09T00:00:00.000Z'));
    const res = await svc.execute({ fileBuffer: Buffer.from(CSV), filename: 'batch.csv' });
    expect(res.validRows).toBe(1);
    expect(res.rejectedRows).toBe(1);
    expect(res.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(repo.saved).toHaveLength(1);
    expect(catalog.dbs).toContain('fincard_loyalty');
    expect(storage.puts.some((p) => p.key.includes('/2026/07/PART01/'))).toBe(true);
    expect(storage.puts.some((p) => p.key.includes('manifest'))).toBe(true);
  });
});
