import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import type { UploadTransactionsUseCase } from '../../../application/ports/in/upload-transactions.usecase.js';
import type { GetSettlementUseCase } from '../../../application/ports/in/get-settlement.usecase.js';

const CSV = `transaction_id,member_id,partner_id,points_earned,points_redeemed,transaction_date,partner_name
TXN001,MEM001,PART01,150,0,2026-07-01,Café Central`;

function makeApp(overrides: { upload?: Partial<UploadTransactionsUseCase>; settlement?: Partial<GetSettlementUseCase> } = {}) {
  const upload: UploadTransactionsUseCase = {
    execute: overrides.upload?.execute ?? (async () => ({
      batchId: 'b1', validRows: 1, rejectedRows: 0, flaggedRows: 0, errors: [],
      processedAt: '2026-07-09T00:00:00.000Z', sourceSha256: 'x'.repeat(64), s3Prefixes: ['2026/07/PART01'],
    })),
  };
  const settlement: GetSettlementUseCase = {
    execute: overrides.settlement?.execute ?? (async () => ({
      partner_id: 'PART01', partner_name: 'Café Central', period: { from: '2026-07-01', to: '2026-07-01' },
      summary: { total_transactions: 1, total_points_earned: 150, total_points_redeemed: 0, net_points_owed: 150, unique_members: 1 },
      daily_breakdown: [{ date: '2026-07-01', transactions: 1, points_earned: 150, points_redeemed: 0 }],
    })),
  };
  return buildApp({ upload, settlement });
}

describe('routes', () => {
  it('POST upload returns 201 with manifest', async () => {
    const app = makeApp();
    const form = new FormData();
    form.append('file', new Blob([CSV], { type: 'text/csv' }), 'batch.csv');
    const res = await app.inject({ method: 'POST', url: '/api/v1/transactions/upload', payload: form });
    expect(res.statusCode).toBe(201);
    expect(res.json().validRows).toBe(1);
    await app.close();
  });
  it('POST upload returns 400 when all rows invalid', async () => {
    const app = makeApp({ upload: { execute: async () => ({
      batchId: 'b', validRows: 0, rejectedRows: 1, flaggedRows: 0,
      errors: [{ row: 1, field: 'member_id', value: 'X', message: 'bad' }],
      processedAt: 'now', sourceSha256: 'y'.repeat(64), s3Prefixes: [],
    }) } });
    const form = new FormData();
    form.append('file', new Blob(['bad'], { type: 'text/csv' }), 'b.csv');
    const res = await app.inject({ method: 'POST', url: '/api/v1/transactions/upload', payload: form });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_FAILED');
    await app.close();
  });
  it('GET settlement validates query and returns 200', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/settlements/PART01?from=2026-07-01&to=2026-07-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json().partner_id).toBe('PART01');
    await app.close();
  });
  it('GET settlement returns 422 on bad date', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/settlements/PART01?from=bad&to=2026-07-01' });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
