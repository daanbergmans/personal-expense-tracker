// Shared by server and client.

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Identifies "the same payment": same direction, same counterparty (or description) and same category. */
export function patternKey(tx: { type: string; party: string; description: string; categoryId: number }): string {
  return `${tx.type}|${norm(tx.party) || norm(tx.description)}|${tx.categoryId}`;
}

/** YYYY-MM(-DD) -> months since year 0, for month arithmetic. */
export const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

export const monthFromIndex = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

/** Date a monthly payment falls on for a budget month, clamped to the month's length (31 -> 30 in April). */
export function paymentDate(budgetMonth: string, day: number, monthOffset: number): string {
  const index = monthIndex(budgetMonth) + monthOffset;
  const lastDay = new Date(Math.floor(index / 12), (index % 12) + 1, 0).getDate();
  return `${monthFromIndex(index)}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export type PaymentKind = 'monthly' | 'frequent';

/** A payment saved for quick adding. */
export interface QuickPayment {
  id: number;
  kind: PaymentKind;
  type: 'income' | 'expense';
  party: string;
  description: string;
  /** Cents, or null when it varies and is filled in each time. */
  amount: number | null;
  categoryId: number;
  /** Monthly only: day of month it is paid, or null when it varies. */
  day: number | null;
  /** Monthly only: 0 = paid in the budget month, -1 = in the month before (e.g. rent paid on the 31st). */
  monthOffset: number;
  /** Income only: the expense category this pays back (e.g. a friend's share of Spotify). */
  offsetCategoryId: number | null;
}

/** Most recent details per counterparty, used to autofill the add row. */
export interface Payee {
  type: 'income' | 'expense';
  party: string;
  description: string;
  categoryId: number;
  amount: number | null;
}
