import { db } from './db';

/** Request validation shared by the route modules. */

export type TxType = 'income' | 'expense';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function asType(value: unknown): TxType {
  if (value === 'income' || value === 'expense') return value;
  throw new HttpError(400, 'type must be "income" or "expense"');
}

export function asName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new HttpError(400, 'name is required');
  return name;
}

export function asId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'invalid id');
  return id;
}

export function categoryType(id: number): TxType {
  const row = db.prepare('SELECT type FROM categories WHERE id = ?').get(id) as { type: TxType } | undefined;
  if (!row) throw new HttpError(400, 'unknown category');
  return row.type;
}
