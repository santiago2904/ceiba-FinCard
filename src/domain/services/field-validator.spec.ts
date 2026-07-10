import { describe, it, expect } from 'vitest';
import { validateRows } from './field-validator.js';
import type { RawTransactionRow } from '../model/transaction.js';

const base: RawTransactionRow = {
  transaction_id: 'TXN001', member_id: 'MEM001', partner_id: 'PART01',
  points_earned: '150', points_redeemed: '0', transaction_date: '2026-07-01', partner_name: 'Café Central',
};

describe('validateRows', () => {
  it('passes a fully valid row', () => {
    const { valid, errors } = validateRows([base]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });
  it('flags invalid member_id with row number', () => {
    const { valid, errors } = validateRows([{ ...base, member_id: 'MEMX1' }]);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatchObject({ row: 1, field: 'member_id' });
  });
  it('flags negative points_earned', () => {
    const { errors } = validateRows([{ ...base, points_earned: '-5' }]);
    expect(errors[0]).toMatchObject({ row: 1, field: 'points_earned' });
  });
  it('detects duplicate transaction_id on second occurrence', () => {
    const { valid, errors } = validateRows([base, { ...base, member_id: 'MEM002' }]);
    expect(valid).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 2, field: 'transaction_id' });
  });
});
