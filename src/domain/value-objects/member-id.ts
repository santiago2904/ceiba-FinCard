import { ValidationError } from '../errors.js';
const RE = /^MEM\d{3}$/;
export class MemberId {
  private constructor(public readonly value: string) {}
  static create(raw: string): MemberId {
    if (!RE.test(raw)) throw new ValidationError('member_id', raw, 'member_id debe cumplir el formato MEM + 3 dígitos');
    return new MemberId(raw);
  }
}
