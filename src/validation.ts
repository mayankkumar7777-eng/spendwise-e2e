import type { FieldError } from './errors.js';
import { isValidIsoDate } from './dates.js';
import { MEALS_MAX_PAISE, RECEIPT_THRESHOLD_PAISE, parseAmount } from './money.js';

export const CATEGORIES = [
  'Travel',
  'Meals',
  'Lodging',
  'Office Supplies',
  'Internet & Phone',
  'Training',
] as const;
export const POLICY_START = '2026-01-01';

export const FIELD_MESSAGES: Record<string, string> = {
  AMOUNT_INVALID: 'Enter a valid amount.',
  AMOUNT_OUT_OF_RANGE: 'Amount must be between 1.00 and 100000.00.',
  AMOUNT_PRECISION: 'Amount can have at most 2 decimal places.',
  DATE_INVALID: 'Enter a valid date.',
  DATE_IN_FUTURE: 'Date cannot be in the future.',
  DATE_BEFORE_POLICY_START: 'Date cannot be before 2026-01-01.',
  INVALID_CATEGORY: 'Select a valid category.',
  DESCRIPTION_LENGTH: 'Description must be 3 to 200 characters.',
  MEALS_LIMIT_EXCEEDED: 'Meals claims cannot exceed 2000.00.',
  RECEIPT_REQUIRED: 'A receipt is required when the amount is above 2000.00.',
  FILE_TOO_LARGE: 'Receipt must be 2 MB or smaller.',
  FILE_TYPE_NOT_ALLOWED: 'Receipt must be a JPG, PNG or PDF file.',
};

export const fieldError = (field: string, code: string): FieldError => ({
  field,
  code,
  message: FIELD_MESSAGES[code] ?? code,
});

export interface ClaimFields {
  date: string;
  category: string;
  amountPaise: number;
  description: string;
}

export type ReceiptState = 'present' | 'absent' | 'invalid';

export type ValidationResult = { ok: true; value: ClaimFields } | { ok: false; fields: FieldError[] };

export function validateClaimFields(
  raw: { date?: unknown; category?: unknown; amount?: unknown; description?: unknown },
  ctx: { today: string; receipt: ReceiptState },
): ValidationResult {
  const errors: FieldError[] = [];

  let date = '';
  if (typeof raw.date !== 'string' || !isValidIsoDate(raw.date.trim())) {
    errors.push(fieldError('date', 'DATE_INVALID'));
  } else {
    date = raw.date.trim();
    if (date > ctx.today) errors.push(fieldError('date', 'DATE_IN_FUTURE'));
    else if (date < POLICY_START) errors.push(fieldError('date', 'DATE_BEFORE_POLICY_START'));
  }

  const category = typeof raw.category === 'string' ? raw.category : '';
  const categoryOk = (CATEGORIES as readonly string[]).includes(category);
  if (!categoryOk) errors.push(fieldError('category', 'INVALID_CATEGORY'));

  let amountPaise = 0;
  const amount = parseAmount(raw.amount);
  if ('code' in amount) {
    errors.push(fieldError('amount', amount.code));
  } else {
    amountPaise = amount.paise;
    if (categoryOk && category === 'Meals' && amountPaise > MEALS_MAX_PAISE) {
      errors.push(fieldError('amount', 'MEALS_LIMIT_EXCEEDED'));
    }
    if (amountPaise > RECEIPT_THRESHOLD_PAISE && ctx.receipt === 'absent' && category !== 'Meals') {
      errors.push(fieldError('receipt', 'RECEIPT_REQUIRED'));
    }
  }

  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const length = Array.from(description).length;
  if (length < 3 || length > 200) errors.push(fieldError('description', 'DESCRIPTION_LENGTH'));

  if (errors.length > 0) return { ok: false, fields: errors };
  return { ok: true, value: { date, category, amountPaise, description } };
}
