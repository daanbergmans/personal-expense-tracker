import { db } from './db';
import { patternKey, type QuickPayment } from '../shared/patterns';

export interface TotalRow {
  month: string; // YYYY-MM
  categoryId: number;
  total: number; // cents; can be negative for an expense category when repayments exceed spending
}

/**
 * Net totals per budget month and category. Income that pays back an expense is subtracted from
 * that expense category instead of counting as income, so both show what things really cost.
 */
export function monthlyTotals(monthPrefix = ''): TotalRow[] {
  return db.prepare(`
    SELECT month, categoryId, SUM(total) AS total FROM (
      SELECT month, category_id AS categoryId, amount AS total
      FROM transactions WHERE offset_category_id IS NULL AND month LIKE ?
      UNION ALL
      SELECT month, offset_category_id AS categoryId, -amount AS total
      FROM transactions WHERE offset_category_id IS NOT NULL AND month LIKE ?
    )
    GROUP BY month, categoryId
    ORDER BY month
  `).all(`${monthPrefix}%`, `${monthPrefix}%`) as unknown as TotalRow[];
}

export interface SearchFilters {
  q: string;
  type?: 'income' | 'expense';
  categoryId?: number;
  year?: number;
}

const SEARCH_LIMIT = 500;

/** Finds entries whose who or description contains `q`, newest first. */
export function searchTransactions({ q, type, categoryId, year }: SearchFilters) {
  const where = ['(party LIKE ? OR description LIKE ?)'];
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const params: (string | number)[] = [like, like];
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  if (categoryId) {
    where.push('(category_id = ? OR offset_category_id = ?)');
    params.push(categoryId, categoryId);
  }
  if (year) {
    where.push('month LIKE ?');
    params.push(`${year}-%`);
  }
  const condition = where.join(' AND ').replace(/LIKE \?/g, "LIKE ? ESCAPE '\\'");
  const summary = db.prepare(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
    FROM transactions WHERE ${condition}
  `).get(...params) as { count: number; income: number; expense: number };
  const rows = db.prepare(`
    SELECT id, month, date, type, party, description, amount, category_id AS categoryId, offset_category_id AS offsetCategoryId
    FROM transactions WHERE ${condition}
    ORDER BY date DESC, id DESC LIMIT ${SEARCH_LIMIT}
  `).all(...params);
  return { ...summary, limited: summary.count > SEARCH_LIMIT, rows };
}

export interface PaymentHistory {
  id: number;
  /** Most recent matching entry, if any. */
  lastAmount: number | null;
  lastDate: string | null;
  /** Average of the last three matching entries, used to estimate payments whose amount varies. */
  recentAverage: number | null;
}

/** For each saved payment, what the matching entries in your history look like. */
export function paymentHistory(payments: QuickPayment[]): PaymentHistory[] {
  const rows = db.prepare(`
    SELECT type, party, description, amount, date, category_id AS categoryId FROM transactions ORDER BY date, id
  `).all() as { type: string; party: string; description: string; amount: number; date: string; categoryId: number }[];
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = patternKey(r);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  return payments.map((p) => {
    const matches = byKey.get(patternKey(p)) ?? [];
    const last = matches[matches.length - 1];
    const recent = matches.slice(-3);
    return {
      id: p.id,
      lastAmount: last?.amount ?? null,
      lastDate: last?.date ?? null,
      recentAverage: recent.length ? Math.round(recent.reduce((s, r) => s + r.amount, 0) / recent.length) : null,
    };
  });
}
