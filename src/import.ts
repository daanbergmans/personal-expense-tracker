import Papa from 'papaparse';
import type { TxType } from './api';
import { monthKey, parseAmount } from './format';

export type DateFormat = 'dmy' | 'mdy' | 'ymd';

/** Where the "Incoming" / "Outgoing" blocks start in an exported month sheet. */
export interface MonthSheetLayout {
  headerRow: number;
  incomeCol: number;
  expenseCol: number;
}

/** Column indexes for a plain one-row-per-entry CSV; -1 = not present. */
export interface ColumnMapping {
  hasHeader: boolean;
  date: number;
  party: number;
  description: number;
  amount: number;
  category: number;
  /** How to tell income from expenses. */
  typeMode: 'income' | 'expense' | 'sign';
}

/** One entry as read from a file, before category resolution. */
export interface Candidate {
  key: string;
  type: TxType;
  date: string | null; // YYYY-MM-DD
  party: string;
  description: string;
  amount: number | null; // cents
  categoryName: string;
  error?: string;
}

export function readCsv(text: string): string[][] {
  const { data } = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  return data.map((row) => row.map((cell) => cell.trim()));
}

/** Finds the "Incoming" and "Outgoing" header cells of a month sheet export. */
export function detectMonthSheet(rows: string[][]): MonthSheetLayout | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = rows[r].map((c) => c.toLowerCase());
    const incomeCol = cells.indexOf('incoming');
    const expenseCol = cells.indexOf('outgoing');
    if (incomeCol !== -1 || expenseCol !== -1) return { headerRow: r, incomeCol, expenseCol };
  }
  return null;
}

/** Month sheet blocks are 5 columns wide: date, who, description, amount, category. */
export function extractMonthSheet(rows: string[][], layout: MonthSheetLayout, fmt: DateFormat): Candidate[] {
  const out: Candidate[] = [];
  const blocks = [
    ['income', layout.incomeCol],
    ['expense', layout.expenseCol],
  ] as const;
  for (let r = layout.headerRow + 1; r < rows.length; r++) {
    for (const [type, col] of blocks) {
      if (col === -1) continue;
      const [date = '', party = '', description = '', amount = '', category = ''] = rows[r].slice(col, col + 5);
      if (!amount && !party && !description) continue;
      out.push(candidate(`${r}:${type}`, type, date, party, description, amount, category, fmt));
    }
  }
  return out;
}

export function extractColumns(rows: string[][], m: ColumnMapping, fmt: DateFormat): Candidate[] {
  const out: Candidate[] = [];
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '') : '');
  for (let r = m.hasHeader ? 1 : 0; r < rows.length; r++) {
    const row = rows[r];
    const rawAmount = cell(row, m.amount);
    if (!rawAmount && !cell(row, m.party) && !cell(row, m.description)) continue;
    const negative = /^\(.*\)$|^-|-$/.test(rawAmount.replace(/[€\s]/g, ''));
    const type: TxType = m.typeMode === 'sign' ? (negative ? 'expense' : 'income') : m.typeMode;
    out.push(candidate(String(r), type, cell(row, m.date), cell(row, m.party), cell(row, m.description), rawAmount, cell(row, m.category), fmt));
  }
  return out;
}

function candidate(
  key: string, type: TxType, rawDate: string, party: string, description: string,
  rawAmount: string, categoryName: string, fmt: DateFormat,
): Candidate {
  const date = parseDate(rawDate, fmt);
  const amount = parseAmount(rawAmount.replace(/[()-]/g, ''));
  const error = !date ? `Invalid date "${rawDate}"` : amount === null ? `Invalid amount "${rawAmount}"` : undefined;
  return { key, type, date, party, description, amount, categoryName, error };
}

export function parseDate(raw: string, fmt: DateFormat): string | null {
  const parts = raw.split(/[ T]/)[0].split(/[/.-]/).map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null;
  let [y, m, d] = fmt === 'ymd' ? parts : fmt === 'dmy' ? [parts[2], parts[1], parts[0]] : [parts[2], parts[0], parts[1]];
  if (y < 100) y += 2000;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${monthKey(y, m)}-${String(d).padStart(2, '0')}`;
}

/** Guesses the date format from sample values; day-first wins when ambiguous. */
export function detectDateFormat(samples: string[]): DateFormat {
  const split = samples.filter(Boolean).map((s) => s.split(/[ T]/)[0].split(/[/.-]/).map(Number));
  if (split.some((p) => p[0] > 31)) return 'ymd';
  if (split.some((p) => p[0] > 12)) return 'dmy';
  if (split.some((p) => p[1] > 12)) return 'mdy';
  return 'dmy';
}

const MONTH_WORDS = [
  ['january', 'januari'], ['february', 'februari'], ['march', 'maart'], ['april'], ['may', 'mei'], ['june', 'juni'],
  ['july', 'juli'], ['august', 'augustus'], ['september'], ['october', 'oktober'], ['november'], ['december'],
];

/**
 * Guesses which budget month a month sheet belongs to: a month name in the file name
 * (e.g. "Expenses 2026 - January.csv") wins, otherwise the latest month among the dates, since a
 * sheet usually runs from payday in the previous month into the budget month.
 */
export function inferMonth(fileName: string, dates: string[]): string {
  const name = fileName.toLowerCase();
  const monthFromName = MONTH_WORDS.findIndex((words) => words.some((w) => new RegExp(`\\b${w}\\b`).test(name)));
  if (monthFromName !== -1) {
    const m = monthFromName + 1;
    const yearInName = name.match(/\b(19|20)\d{2}\b/);
    const yearFromDates = dates.find((d) => Number(d.slice(5, 7)) === m)?.slice(0, 4);
    const year = Number(yearInName?.[0] ?? yearFromDates ?? mostCommon(dates.map((d) => d.slice(0, 4))) ?? new Date().getFullYear());
    return monthKey(year, m);
  }
  const now = new Date();
  return dates.map((d) => d.slice(0, 7)).sort().at(-1) ?? monthKey(now.getFullYear(), now.getMonth() + 1);
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Guesses column roles from header names (English and Dutch). */
export function guessMapping(header: string[]): ColumnMapping {
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h.toLowerCase().includes(n)));
  return {
    hasHeader: true,
    date: find('date', 'datum'),
    party: find('who', 'party', 'name', 'naam', 'tegenpartij', 'counterparty', 'payee'),
    description: find('description', 'omschrijving', 'mededeling', 'memo'),
    amount: find('amount', 'bedrag'),
    category: find('category', 'categorie'),
    typeMode: 'sign',
  };
}
