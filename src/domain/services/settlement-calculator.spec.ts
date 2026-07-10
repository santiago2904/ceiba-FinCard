import { describe, it, expect } from 'vitest';
import { calculateSettlement, enumerateDates } from './settlement-calculator.js';
import type { Transaction } from '../model/transaction.js';

const t = (o: Partial<Transaction> & { transactionId: string }): Transaction => ({
  memberId: 'MEM001', partnerId: 'PART01', pointsEarned: 0, pointsRedeemed: 0,
  transactionDate: '2026-07-01', partnerName: 'Café Central', ...o,
});

describe('enumerateDates', () => {
  it('is inclusive of both ends', () => {
    expect(enumerateDates('2026-07-01', '2026-07-03')).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });
});

describe('calculateSettlement', () => {
  const input = {
    partnerId: 'PART01', partnerName: 'Café Central', from: '2026-07-01', to: '2026-07-02',
    transactions: [
      t({ transactionId: 'A', pointsEarned: 150, memberId: 'MEM001' }),
      t({ transactionId: 'B', pointsRedeemed: 50, memberId: 'MEM002' }),
    ],
  };
  it('computes summary and net owed', () => {
    const s = calculateSettlement(input);
    expect(s.summary.total_transactions).toBe(2);
    expect(s.summary.total_points_earned).toBe(150);
    expect(s.summary.total_points_redeemed).toBe(50);
    expect(s.summary.net_points_owed).toBe(100);
    expect(s.summary.unique_members).toBe(2);
  });
  it('reports 0 net when negative', () => {
    const s = calculateSettlement({ ...input, transactions: [t({ transactionId: 'A', pointsRedeemed: 500 })] });
    expect(s.summary.net_points_owed).toBe(0);
  });
  it('fills all days in range with zeros', () => {
    const s = calculateSettlement(input);
    expect(s.daily_breakdown).toHaveLength(2);
    expect(s.daily_breakdown[1]).toEqual({ date: '2026-07-02', transactions: 0, points_earned: 0, points_redeemed: 0 });
  });
});
