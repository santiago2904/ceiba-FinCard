export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends DomainError {
  constructor(public readonly field: string, public readonly value: unknown, message: string) {
    super(message);
  }
}
export class NotFoundError extends DomainError {}
