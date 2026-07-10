import { ValidationError } from '../errors.js';
export class Points {
  private constructor(public readonly value: number) {}
  static create(raw: string | number, field = 'points'): Points {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new ValidationError(field, raw, `${field} debe ser un entero no negativo`);
    return new Points(n);
  }
}
