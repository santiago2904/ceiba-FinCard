import { describe, it, expect } from 'vitest';
import { toTransaction } from './transaction.js';

describe('toTransaction', () => {
  it('maps a validated raw row into a Transaction', () => {
    const t = toTransaction({
      transaction_id: 'TXN001', member_id: 'MEM001', partner_id: 'PART01',
      points_earned: '150', points_redeemed: '0', transaction_date: '2026-07-01',
      partner_name: 'Café Central',
    });
    expect(t).toEqual({
      transactionId: 'TXN001', memberId: 'MEM001', partnerId: 'PART01',
      pointsEarned: 150, pointsRedeemed: 0, transactionDate: '2026-07-01',
      partnerName: 'Café Central',
    });
  });
});
