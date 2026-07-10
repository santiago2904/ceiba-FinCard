import { describe, it, expect } from 'vitest';
import { applyBusinessRules } from './business-rules.js';
import type { Transaction } from '../model/transaction.js';

const t = (o: Partial<Transaction> & { transactionId: string }): Transaction => ({
  memberId: 'MEM001', partnerId: 'PART01', pointsEarned: 100, pointsRedeemed: 0,
  transactionDate: '2026-07-01', partnerName: 'Café Central', ...o,
});
const NOW = new Date('2026-07-09T00:00:00.000Z');

describe('applyBusinessRules', () => {
  it('RN-04 flags future dates', () => {
    const { clean, flagged } = applyBusinessRules([t({ transactionId: 'A', transactionDate: '2027-01-01' })], NOW);
    expect(clean).toHaveLength(0);
    expect(flagged[0].flagReason).toBe('RN-04');
  });
  it('RN-04 flags dates older than 2 years', () => {
    const { flagged } = applyBusinessRules([t({ transactionId: 'A', transactionDate: '2024-01-01' })], NOW);
    expect(flagged[0].flagReason).toBe('RN-04');
  });
  it('RN-01 flags txns after cumulative net exceeds 10000 for a member/day', () => {
    const txns = [
      t({ transactionId: 'A', pointsEarned: 9000 }),
      t({ transactionId: 'B', pointsEarned: 2000 }),
      t({ transactionId: 'C', pointsEarned: 500 }),
    ];
    const { clean, flagged } = applyBusinessRules(txns, NOW);
    expect(clean.map((x) => x.transactionId)).toEqual(['A', 'B']);
    expect(flagged.map((x) => [x.transactionId, x.flagReason])).toEqual([['C', 'RN-01']]);
  });
  it('RN-03 flags the 6th+ txn for same member/partner/day', () => {
    const txns = Array.from({ length: 7 }, (_, i) => t({ transactionId: `T${i}`, pointsEarned: 1 }));
    const { clean, flagged } = applyBusinessRules(txns, NOW);
    expect(clean).toHaveLength(5);
    expect(flagged).toHaveLength(2);
    expect(flagged.every((x) => x.flagReason === 'RN-03')).toBe(true);
  });
});
