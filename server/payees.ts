import type { Payee, QuickPayment } from '../shared/patterns';

export interface HistoryRow {
  id: number;
  date: string;
  type: 'income' | 'expense';
  party: string;
  description: string;
  amount: number;
  categoryId: number;
}

/**
 * Known counterparties for autofilling the add row: saved quick payments first, then names from
 * history ordered by how often they're used, each with its most recent details.
 */
export function buildPayees(rows: HistoryRow[], saved: QuickPayment[]): Payee[] {
  // per counterparty, the entries of its most used category (e.g. "Spar" as Lunch rather than Groceries)
  const groups = new Map<string, Map<number, HistoryRow[]>>();
  for (const row of rows) {
    const party = row.party.trim().toLowerCase();
    if (!party) continue;
    const key = `${row.type}|${party}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const byCategory = groups.get(key)!;
    if (!byCategory.has(row.categoryId)) byCategory.set(row.categoryId, []);
    byCategory.get(row.categoryId)!.push(row);
  }

  const fromHistory = [...groups.values()]
    .map((byCategory) => [...byCategory.values()].sort((a, b) => b.length - a.length)[0])
    .sort((a, b) => b.length - a.length)
    .map((list) => list.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)[list.length - 1]);

  const payees: Payee[] = [];
  const seen = new Set<string>();
  for (const { type, party, description, categoryId, amount } of [...saved, ...fromHistory]) {
    const key = `${type}|${party.trim().toLowerCase()}`;
    if (!party.trim() || seen.has(key)) continue;
    seen.add(key);
    payees.push({ type, party: party.trim(), description, categoryId, amount });
  }
  return payees;
}
