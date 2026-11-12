/**
 * A business rule said no. `code` is stable so screens can pick the right
 * sheet or message; `message` is for logs and tests, never shown as-is.
 */
export type DataErrorCode =
  | 'not_found'
  | 'name_required'
  | 'invalid_currency'
  | 'invalid_amount'
  | 'limit_reached'
  | 'archived'
  | 'default_ledger'
  | 'invalid_target'
  | 'category_depth'
  | 'category_kind_mismatch'
  | 'category_kind_locked'
  | 'has_subcategories'
  | 'system_category'
  | 'invalid_split'
  | 'nothing_owed'
  | 'same_currency'
  | 'same_direction';

export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DataError';
  }
}

export function requireName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new DataError('name_required', 'Name is required');
  return trimmed;
}
