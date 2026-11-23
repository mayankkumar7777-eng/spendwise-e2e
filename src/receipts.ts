import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FieldError } from './errors.js';
import { fieldError } from './validation.js';

export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

export interface StoredReceipt {
  file: string;
  mime: string;
}

export type ReceiptCheck = { ok: true; mime: string; ext: string } | { ok: false; error: FieldError };

// File type is decided from content signature, never from the client-supplied name or type.
export function checkReceipt(data: Buffer, truncated: boolean): ReceiptCheck {
  if (truncated || data.length > MAX_RECEIPT_BYTES) {
    return { ok: false, error: fieldError('receipt', 'FILE_TOO_LARGE') };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { ok: true, mime: 'image/jpeg', ext: 'jpg' };
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ok: true, mime: 'image/png', ext: 'png' };
  }
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { ok: true, mime: 'application/pdf', ext: 'pdf' };
  }
  return { ok: false, error: fieldError('receipt', 'FILE_TYPE_NOT_ALLOWED') };
}

export function storeReceipt(dir: string, data: Buffer, mime: string, ext: string): StoredReceipt {
  mkdirSync(dir, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  writeFileSync(join(dir, file), data, { mode: 0o600 });
  return { file, mime };
}

export function removeReceipt(dir: string, file: string | null): void {
  if (!file) return;
  try {
    unlinkSync(join(dir, file));
  } catch {
    // already gone
  }
}
