import { describe, it, expect } from 'vitest';
import { MemberId } from './member-id.js';
import { PartnerId } from './partner-id.js';
import { Points } from './points.js';
import { TransactionDate } from './transaction-date.js';
import { ValidationError } from '../errors.js';

describe('MemberId', () => {
  it('accepts MEM + 3 digits', () => expect(MemberId.create('MEM001').value).toBe('MEM001'));
  it('rejects bad format', () => expect(() => MemberId.create('MEMX1')).toThrow(ValidationError));
});
describe('PartnerId', () => {
  it('accepts PART + 2 digits', () => expect(PartnerId.create('PART01').value).toBe('PART01'));
  it('rejects bad format', () => expect(() => PartnerId.create('PART1')).toThrow(ValidationError));
});
describe('Points', () => {
  it('accepts non-negative int from string', () => expect(Points.create('150').value).toBe(150));
  it('rejects negative', () => expect(() => Points.create('-1')).toThrow(ValidationError));
  it('rejects decimals', () => expect(() => Points.create('1.5')).toThrow(ValidationError));
});
describe('TransactionDate', () => {
  it('accepts valid ISO date', () => expect(TransactionDate.create('2026-07-01').value).toBe('2026-07-01'));
  it('rejects invalid date', () => expect(() => TransactionDate.create('2026-13-40')).toThrow(ValidationError));
  it('rejects wrong format', () => expect(() => TransactionDate.create('01/07/2026')).toThrow(ValidationError));
});
