import { describe, it, expect } from 'vitest';
import { GetSettlementService } from './get-settlement.service.js';
import { FakeRepo } from '../../../test/fakes/index.js';
import { NotFoundError } from '../../domain/errors.js';

class FakePartners { async findName(id: string) { return id === 'PART01' ? 'Café Central' : null; } }

describe('GetSettlementService', () => {
  it('builds settlement from repo transactions', async () => {
    const repo = new FakeRepo();
    await repo.saveMany([
      { transactionId: 'A', memberId: 'MEM001', partnerId: 'PART01', pointsEarned: 150, pointsRedeemed: 0, transactionDate: '2026-07-01', partnerName: 'Café Central' },
    ], { batchId: 'b', processedAt: '2026-07-09T00:00:00.000Z' });
    const svc = new GetSettlementService(repo, new FakePartners());
    const s = await svc.execute({ partnerId: 'PART01', from: '2026-07-01', to: '2026-07-01' });
    expect(s.summary.total_points_earned).toBe(150);
    expect(s.partner_name).toBe('Café Central');
  });
  it('throws NotFoundError for unknown partner', async () => {
    const svc = new GetSettlementService(new FakeRepo(), new FakePartners());
    await expect(svc.execute({ partnerId: 'PART99', from: '2026-07-01', to: '2026-07-01' })).rejects.toThrow(NotFoundError);
  });
});
