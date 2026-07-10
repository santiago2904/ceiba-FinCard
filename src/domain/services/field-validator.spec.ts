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
  it('excludes a row with a missing required column and reports it with the correct row number', () => {
    const { valid, errors } = validateRows([{ ...base, partner_name: '' }]);
    expect(valid).toHaveLength(0);
    expect(errors).toContainEqual(expect.objectContaining({ row: 1, field: 'partner_name' }));
  });
  it('collects multiple errors on a single row', () => {
    const { valid, errors } = validateRows([{ ...base, member_id: 'MEMX1', points_earned: '-5' }]);
    expect(valid).toHaveLength(0);
    expect(errors).toContainEqual(expect.objectContaining({ row: 1, field: 'member_id' }));
    expect(errors).toContainEqual(expect.objectContaining({ row: 1, field: 'points_earned' }));
  });
  it('treats the second row as first-seen when the first occurrence of a duplicate transaction_id was invalid', () => {
    const { valid, errors } = validateRows([
      { ...base, member_id: 'MEMX1' },
      { ...base, member_id: 'MEM002' },
    ]);
    expect(errors).toContainEqual(expect.objectContaining({ row: 1, field: 'member_id' }));
    expect(errors.some((e) => e.field === 'transaction_id')).toBe(false);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ memberId: 'MEM002' });
  });
});
