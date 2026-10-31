export type DomainErrorCode = 'conflict' | 'inactive_admission';

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode) {
    super(code);
    this.name = 'DomainError';
  }
}
