import { MemberId } from '../value-objects/member-id.js';
import { PartnerId } from '../value-objects/partner-id.js';
import { Points } from '../value-objects/points.js';
import { TransactionDate } from '../value-objects/transaction-date.js';
import { ValidationError } from '../errors.js';
import { toTransaction, type RawTransactionRow, type Transaction } from '../model/transaction.js';
import type { RowError } from '../model/manifest.js';

const REQUIRED: (keyof RawTransactionRow)[] = [
  'transaction_id', 'member_id', 'partner_id', 'points_earned',
  'points_redeemed', 'transaction_date', 'partner_name',
];

export function validateRows(rows: RawTransactionRow[]): { valid: Transaction[]; errors: RowError[] } {
  const valid: Transaction[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const rowErrors: RowError[] = [];

    for (const col of REQUIRED) {
      if (row[col] === undefined || row[col] === null || row[col] === '') {
        rowErrors.push({ row: rowNum, field: col, value: row[col], message: `${col} es requerido` });
      }
    }
    if (rowErrors.length === 0) {
      const checks: [() => void][] = [
        [() => MemberId.create(row.member_id)],
        [() => PartnerId.create(row.partner_id)],
        [() => Points.create(row.points_earned, 'points_earned')],
        [() => Points.create(row.points_redeemed, 'points_redeemed')],
        [() => TransactionDate.create(row.transaction_date)],
      ];
      for (const [fn] of checks) {
        try { fn(); } catch (e) {
          if (e instanceof ValidationError) rowErrors.push({ row: rowNum, field: e.field, value: e.value, message: e.message });
        }
      }
      if (seen.has(row.transaction_id)) {
        rowErrors.push({ row: rowNum, field: 'transaction_id', value: row.transaction_id, message: 'transaction_id duplicado dentro del archivo' });
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      seen.add(row.transaction_id);
      valid.push(toTransaction(row));
    }
  });

  return { valid, errors };
}
