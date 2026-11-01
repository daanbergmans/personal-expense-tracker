import { monthIndex, monthFromIndex } from '../shared/patterns';
import type { Category, TotalRow, Transaction } from './api';

/** How a month's money splits up. Repayments reduce spending (or saving) instead of counting as income. */
export interface MoneySplit {
  income: number;
  spent: number;
  saved: number;
  /** income - spent - saved: what's left in the account. */
  left: number;
  /** Share of income not spent (saved + left), or null without income. */
  savingsRate: number | null;
}

export function splitFromTotals(totals: Map<number, number>, categories: Category[]): MoneySplit {
  let income = 0;
  let spent = 0;
  let saved = 0;
  for (const c of categories) {
    const v = totals.get(c.id) ?? 0;
    if (c.type === 'income') income += v;
    else if (c.isSaving) saved += v;
    else spent += v;
  }
  const left = income - spent - saved;
  return { income, spent, saved, left, savingsRate: income > 0 ? (income - spent) / income : null };
}

/** Net amount per category for a list of entries, applying repayments to the category they pay back. */
export function netByCategory(transactions: Transaction[]): Map<number, number> {
  const totals = new Map<number, number>();
  const add = (id: number, v: number) => totals.set(id, (totals.get(id) ?? 0) + v);
  for (const t of transactions) {
    if (t.offsetCategoryId) add(t.offsetCategoryId, -t.amount);
    else add(t.categoryId, t.amount);
  }
  return totals;
}

/** Totals for one budget month from the all-months totals list. */
export function totalsForMonth(rows: TotalRow[], month: string): Map<number, number> {
  return new Map(rows.filter((r) => r.month === month).map((r) => [r.categoryId, r.total]));
}

export const AVERAGE_MONTHS = 6;

/**
 * Average per category over the (up to) six budget months before `month` that have any entries.
 * Months without data (before you started tracking) don't drag the average down.
 */
export function averagesBefore(rows: TotalRow[], month: string, count = AVERAGE_MONTHS) {
  const target = monthIndex(month);
  const withData = new Set(rows.map((r) => r.month));
  const months: string[] = [];
  for (let i = target - 1; months.length < count && i >= target - 36; i--) {
    const m = monthFromIndex(i);
    if (withData.has(m)) months.push(m);
  }
  const sums = new Map<number, number>();
  for (const r of rows) if (months.includes(r.month)) sums.set(r.categoryId, (sums.get(r.categoryId) ?? 0) + r.total);
  const averages = new Map<number, number>();
  for (const [id, sum] of sums) averages.set(id, Math.round(sum / months.length));
  return { averages, months };
}

/** Relative difference to an average, e.g. 0.4 for 40% above; null when there is no meaningful average. */
export const relativeTo = (value: number, average: number | undefined) =>
  average && average > 0 ? (value - average) / average : null;
