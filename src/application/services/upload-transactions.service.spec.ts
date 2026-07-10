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
    expect(storage.puts.some((p) => p.key.includes('2026/07/PART01/'))).toBe(true);
    expect(storage.puts.some((p) => p.key.includes('manifest'))).toBe(true);
  });

  it('separates flagged rows from clean rows and reports flaggedRows in the manifest', async () => {
    const storage = new FakeStorage(); const catalog = new FakeCatalog(); const repo = new FakeRepo();
    const svc = new UploadTransactionsService(storage, catalog, repo, () => new Date('2026-07-09T00:00:00.000Z'));
    const csv = `transaction_id,member_id,partner_id,points_earned,points_redeemed,transaction_date,partner_name
TXN001,MEM001,PART01,150,0,2026-07-01,Café Central
TXN002,MEM002,PART01,100,0,2027-01-01,Café Central`;
    const res = await svc.execute({ fileBuffer: Buffer.from(csv), filename: 'batch.csv' });

    expect(repo.saved).toHaveLength(1);
    expect(repo.flagged).toHaveLength(1);
    expect(repo.flagged[0]?.transactionId).toBe('TXN002');
    expect(res.flaggedRows).toBe(1);
    expect(storage.puts.some((p) => p.key.endsWith('.ndjson') && p.key.includes('2027/01/'))).toBe(false);
  });

  it('groups clean rows by distinct year/month/partner partitions', async () => {
    const storage = new FakeStorage(); const catalog = new FakeCatalog(); const repo = new FakeRepo();
    const svc = new UploadTransactionsService(storage, catalog, repo, () => new Date('2026-07-09T00:00:00.000Z'));
    const csv = `transaction_id,member_id,partner_id,points_earned,points_redeemed,transaction_date,partner_name
TXN001,MEM001,PART01,150,0,2026-07-01,Café Central
TXN002,MEM002,PART02,100,0,2026-06-02,Tienda Norte`;
    const res = await svc.execute({ fileBuffer: Buffer.from(csv), filename: 'batch.csv' });

    const dataKeys = storage.puts.filter((p) => p.key.endsWith('.ndjson')).map((p) => p.key);
    expect(dataKeys.some((k) => k.includes('2026/07/PART01/'))).toBe(true);
    expect(dataKeys.some((k) => k.includes('2026/06/PART02/'))).toBe(true);
    expect(dataKeys).toHaveLength(2);
    expect(res.s3Prefixes).toContain('2026/07/PART01');
    expect(res.s3Prefixes).toContain('2026/06/PART02');
  });

  it('writes only a manifest when every row fails field validation', async () => {
    const storage = new FakeStorage(); const catalog = new FakeCatalog(); const repo = new FakeRepo();
    const svc = new UploadTransactionsService(storage, catalog, repo, () => new Date('2026-07-09T00:00:00.000Z'));
    const csv = `transaction_id,member_id,partner_id,points_earned,points_redeemed,transaction_date,partner_name
TXN001,BADID1,PART01,150,0,2026-07-01,Café Central
TXN002,BADID2,PART01,100,0,2026-07-01,Café Central`;
    const res = await svc.execute({ fileBuffer: Buffer.from(csv), filename: 'batch.csv' });

    expect(res.validRows).toBe(0);
    expect(res.rejectedRows).toBeGreaterThan(0);
    expect(repo.saved).toHaveLength(0);
    expect(storage.puts.some((p) => p.key.endsWith('.ndjson'))).toBe(false);
    expect(storage.puts.some((p) => p.key.includes('manifest'))).toBe(true);
  });
});
