import type { FieldValue } from '../contracts/forms';

export function validValue(field: FieldValue, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return !field.required;
  if (field.type === 'signature') return false;
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (field.type === 'yes_no') return typeof value === 'boolean';
  if (typeof value !== 'string' || value.length > 30000) return false;
  return field.type !== 'choice' || !!field.options?.includes(value);
}
