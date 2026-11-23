export const MIN_PAISE = 100;
export const MAX_PAISE = 10_000_000;
export const AUTO_APPROVE_MAX_PAISE = 50_000;
export const MEALS_MAX_PAISE = 200_000;
export const RECEIPT_THRESHOLD_PAISE = 200_000;

export type AmountResult =
  | { paise: number }
  | { code: 'AMOUNT_INVALID' | 'AMOUNT_PRECISION' | 'AMOUNT_OUT_OF_RANGE' };

// Parses a decimal INR amount (string or number) into integer paise without float arithmetic.
export function parseAmount(input: unknown): AmountResult {
  let text: string;
  if (typeof input === 'number' && Number.isFinite(input)) text = String(input);
  else if (typeof input === 'string') text = input.trim();
  else return { code: 'AMOUNT_INVALID' };
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return { code: 'AMOUNT_INVALID' };
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = match[2] ?? '';
  if (fraction.length > 2 && !/^\d{2}0+$/.test(fraction)) return { code: 'AMOUNT_PRECISION' };
  if (whole.length > 9) return { code: 'AMOUNT_OUT_OF_RANGE' };
  const paise = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  if (paise < MIN_PAISE || paise > MAX_PAISE) return { code: 'AMOUNT_OUT_OF_RANGE' };
  return { paise };
}

export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
