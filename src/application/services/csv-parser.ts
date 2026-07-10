import { parse } from 'csv-parse/sync';
import type { RawTransactionRow } from '../../domain/model/transaction.js';
export function parseCsv(buffer: Buffer): RawTransactionRow[] {
  return parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as RawTransactionRow[];
}
