import { ValidationError } from '../errors.js';
const RE = /^PART\d{2}$/;
export class PartnerId {
  private constructor(public readonly value: string) {}
  static create(raw: string): PartnerId {
    if (!RE.test(raw)) throw new ValidationError('partner_id', raw, 'partner_id debe cumplir el formato PART + 2 dígitos');
    return new PartnerId(raw);
  }
}
