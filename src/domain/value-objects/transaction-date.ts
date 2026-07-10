import { ValidationError } from '../errors.js';
const RE = /^\d{4}-\d{2}-\d{2}$/;
export class TransactionDate {
  private constructor(public readonly value: string) {}
  static create(raw: string): TransactionDate {
    if (!RE.test(raw)) throw new ValidationError('transaction_date', raw, 'transaction_date debe tener formato YYYY-MM-DD');
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw)
      throw new ValidationError('transaction_date', raw, 'transaction_date no es una fecha válida');
    return new TransactionDate(raw);
  }
  toDate(): Date { return new Date(`${this.value}T00:00:00.000Z`); }
}
