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
  it('RN-01 flags the breaching txn and all subsequent txns for a member/day', () => {
    const txns = [
      t({ transactionId: 'A', pointsEarned: 9000 }),
      t({ transactionId: 'B', pointsEarned: 2000 }),
      t({ transactionId: 'C', pointsEarned: 500 }),
    ];
    const { clean, flagged } = applyBusinessRules(txns, NOW);
    expect(clean.map((x) => x.transactionId)).toEqual(['A']);
    expect(flagged.map((x) => [x.transactionId, x.flagReason])).toEqual([['B', 'RN-01'], ['C', 'RN-01']]);
  });
  it('RN-03 flags the 6th+ txn for same member/partner/day', () => {
    const txns = Array.from({ length: 7 }, (_, i) => t({ transactionId: `T${i}`, pointsEarned: 1 }));
    const { clean, flagged } = applyBusinessRules(txns, NOW);
    expect(clean).toHaveLength(5);
    expect(flagged).toHaveLength(2);
    expect(flagged.every((x) => x.flagReason === 'RN-03')).toBe(true);
  });
  it('RN-02 flags redeemers beyond the 30% ratio for same partner/day', () => {
    const redeemers = ['R1', 'R2', 'R3', 'R4'].map((id, i) =>
      t({ transactionId: id, memberId: `MEMR${i}`, pointsEarned: 0, pointsRedeemed: 100 }),
    );
    const earners = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'].map((id, i) =>
      t({ transactionId: id, memberId: `MEME${i}`, pointsEarned: 100, pointsRedeemed: 0 }),
    );
    const txns = [...redeemers, ...earners];
    const { clean, flagged } = applyBusinessRules(txns, NOW);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].transactionId).toBe('R4');
    expect(flagged[0].flagReason).toBe('RN-02');
    expect(clean).toHaveLength(9);
  });
  it('RN-01 keeps flagging subsequent txns even if a later redemption drops net below the limit', () => {
    // D is an extra same-partner/day txn for a different member, added solely so the
    // partner/day group is large enough that RN-02's ratio check does not also flag C
    // (isolating this test to RN-01 only).
    const txns = [
      t({ transactionId: 'A', pointsEarned: 9000, pointsRedeemed: 0 }),
      t({ transactionId: 'B', pointsEarned: 2000, pointsRedeemed: 0 }),
      t({ transactionId: 'C', pointsEarned: 0, pointsRedeemed: 5000 }),
      t({ transactionId: 'D', memberId: 'MEM999', pointsEarned: 100, pointsRedeemed: 0 }),
    ];
    const { clean, flagged } = applyBusinessRules(txns, NOW);
    expect(clean.map((x) => x.transactionId)).toEqual(['A', 'D']);
    expect(flagged.map((x) => [x.transactionId, x.flagReason])).toEqual([
      ['B', 'RN-01'],
      ['C', 'RN-01'],
    ]);
  });
  it('precedence: RN-04 wins over RN-03 when both match', () => {
    const txns = Array.from({ length: 6 }, (_, i) =>
      t({ transactionId: `T${i}`, pointsEarned: 1, transactionDate: '2027-01-01' }),
    );
    const { flagged } = applyBusinessRules(txns, NOW);
    const sixth = flagged.find((x) => x.transactionId === 'T5');
    expect(sixth?.flagReason).toBe('RN-04');
  });
});
