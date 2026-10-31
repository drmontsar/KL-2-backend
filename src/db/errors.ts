import { DomainError } from '../errors';

export function rethrowDatabaseError(error: unknown): never {
  const code = (error as { code?: string })?.code;
  if (code && ['23505', '23503', '23P01'].includes(code)) throw new DomainError('conflict');
  throw error;
}
