import { Router } from 'express';
import { db } from './db';
import { monthIndex } from '../shared/patterns';
import { asId, categoryType, DATE_RE, HttpError, MONTH_RE, type TxType } from './validate';

interface DebtRow {
  id: number;
  person: string;
  description: string;
  amount: number;
  date: string;
  category_id: number | null;
  expense_transaction_id: number | null;
  settled_at: string | null;
  settled_note: string;
  expense_month: string | null;
}

export type DebtStatus = 'open' | 'partial' | 'repaid' | 'settled';

const today = () => new Date().toISOString().slice(0, 10);

/** The debt an income entry repays (or null). Only income can repay a debt. */
export function parseDebtLink(body: Record<string, unknown>, type: TxType, current: number | null | undefined): number | null {
  const raw = 'debtId' in body ? body.debtId : (current ?? null);
  if (raw === null || raw === undefined || raw === '') return null;
  const id = asId(raw);
  if (type !== 'income') throw new HttpError(400, 'only income can repay a debt');
  if (!db.prepare('SELECT 1 FROM debts WHERE id = ?').get(id)) throw new HttpError(400, 'unknown debt');
  return id;
}

/** Expense category a repayment of this debt reduces, if the debt has one. */
export function debtCategory(id: number): number | null {
  const row = db.prepare('SELECT category_id AS categoryId FROM debts WHERE id = ?').get(id) as { categoryId: number | null } | undefined;
  return row?.categoryId ?? null;
}

/**
 * Budget month a date most likely belongs to: the month of the latest entry on or before that date
 * (your months run payday to payday), or the date's own month when there's no nearby entry.
 */
export function guessBudgetMonth(date: string): string {
  const row = db.prepare('SELECT month FROM transactions WHERE date <= ? ORDER BY date DESC, id DESC LIMIT 1').get(date) as
    | { month: string }
    | undefined;
  const own = date.slice(0, 7);
  return row && Math.abs(monthIndex(row.month) - monthIndex(own)) <= 1 ? row.month : own;
}

function parseDebt(body: Record<string, unknown>, current?: DebtRow) {
  const person = String(body.person ?? current?.person ?? '').trim();
  if (!person) throw new HttpError(400, 'who owes you is required');
  const description = String(body.description ?? current?.description ?? '').trim();
  const amount = body.amount ?? current?.amount;
  if (!Number.isInteger(amount) || (amount as number) <= 0) throw new HttpError(400, 'amount must be a positive number of cents');
  const date = body.date ?? current?.date ?? today();
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');

  const rawCategory = 'categoryId' in body ? body.categoryId : (current?.category_id ?? null);
  const categoryId = rawCategory === null || rawCategory === '' ? null : asId(rawCategory);
  if (categoryId !== null && categoryType(categoryId) !== 'expense') throw new HttpError(400, 'a debt can only belong to an expense category');

  const rawExpense = 'expenseTransactionId' in body ? body.expenseTransactionId : (current?.expense_transaction_id ?? null);
  const expenseTransactionId = rawExpense === null || rawExpense === '' ? null : asId(rawExpense);
  if (expenseTransactionId !== null) {
    const tx = db.prepare('SELECT type FROM transactions WHERE id = ?').get(expenseTransactionId) as { type: TxType } | undefined;
    if (tx?.type !== 'expense') throw new HttpError(400, 'a debt can only be linked to an outgoing entry');
  }
  return { person, description, amount: amount as number, date, categoryId, expenseTransactionId };
}

/** All debts with their repayments and what's still open. */
function listDebts() {
  const rows = db.prepare(`
    SELECT d.*, t.month AS expense_month
    FROM debts d LEFT JOIN transactions t ON t.id = d.expense_transaction_id
    ORDER BY d.date, d.id
  `).all() as unknown as DebtRow[];
  const repayments = db.prepare(`
    SELECT id, debt_id AS debtId, date, month, amount FROM transactions WHERE debt_id IS NOT NULL ORDER BY date, id
  `).all() as { id: number; debtId: number; date: string; month: string; amount: number }[];

  return rows.map((d) => {
    const own = repayments.filter((r) => r.debtId === d.id).map(({ debtId: _, ...r }) => r);
    const repaid = own.reduce((s, r) => s + r.amount, 0);
    const status: DebtStatus = d.settled_at ? 'settled' : repaid >= d.amount ? 'repaid' : repaid > 0 ? 'partial' : 'open';
    return {
      id: d.id,
      person: d.person,
      description: d.description,
      amount: d.amount,
      date: d.date,
      categoryId: d.category_id,
      expenseTransactionId: d.expense_transaction_id,
      expenseMonth: d.expense_month,
      settledAt: d.settled_at,
      settledNote: d.settled_note,
      repaid,
      remaining: status === 'open' || status === 'partial' ? d.amount - repaid : 0,
      status,
      repayments: own,
    };
  });
}

const getDebt = (id: number) => {
  const debt = listDebts().find((d) => d.id === id);
  if (!debt) throw new HttpError(404, 'debt not found');
  return debt;
};

export const debtsRouter = Router();

debtsRouter.get('/debts', (_req, res) => {
  res.json(listDebts());
});

debtsRouter.post('/debts', (req, res) => {
  const d = parseDebt(req.body ?? {});
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO debts (person, description, amount, date, category_id, expense_transaction_id) VALUES (?, ?, ?, ?, ?, ?)
  `).run(d.person, d.description, d.amount, d.date, d.categoryId, d.expenseTransactionId);
  res.status(201).json(getDebt(Number(lastInsertRowid)));
});

/** Edits a debt; `settled: true/false` closes or reopens it (e.g. paid back in cash, or forgiven). */
debtsRouter.patch('/debts/:id', (req, res) => {
  const id = asId(req.params.id);
  const current = db.prepare('SELECT *, NULL AS expense_month FROM debts WHERE id = ?').get(id) as DebtRow | undefined;
  if (!current) throw new HttpError(404, 'debt not found');
  const body = req.body ?? {};
  const d = parseDebt(body, current);
  let settledAt = current.settled_at;
  let settledNote = current.settled_note;
  if (body.settled !== undefined) {
    settledAt = body.settled ? (current.settled_at ?? today()) : null;
    settledNote = body.settled ? String(body.settledNote ?? current.settled_note ?? '').trim() : '';
  }
  db.prepare(`
    UPDATE debts SET person = ?, description = ?, amount = ?, date = ?, category_id = ?, expense_transaction_id = ?,
      settled_at = ?, settled_note = ?
    WHERE id = ?
  `).run(d.person, d.description, d.amount, d.date, d.categoryId, d.expenseTransactionId, settledAt, settledNote, id);
  res.json(getDebt(id));
});

/** Deletes a debt; repayments stay as normal income entries. */
debtsRouter.delete('/debts/:id', (req, res) => {
  db.prepare('DELETE FROM debts WHERE id = ?').run(asId(req.params.id));
  res.status(204).end();
});

/**
 * Records a repayment as an income entry linked to the debt. It reduces the debt's expense
 * category (if it has one) instead of counting as income.
 */
debtsRouter.post('/debts/:id/repayments', (req, res) => {
  const debt = getDebt(asId(req.params.id));
  const body = req.body ?? {};
  const amount = body.amount ?? debt.remaining;
  if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'amount must be a positive number of cents');
  const date = body.date ?? today();
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
  const month = body.month ?? guessBudgetMonth(date);
  if (typeof month !== 'string' || !MONTH_RE.test(month)) throw new HttpError(400, 'month must be YYYY-MM');

  let categoryId: number;
  if (body.categoryId !== undefined) {
    categoryId = asId(body.categoryId);
    if (categoryType(categoryId) !== 'income') throw new HttpError(400, 'a repayment needs an income category');
  } else {
    const fallback = db.prepare(`
      SELECT id FROM categories WHERE type = 'income' ORDER BY name = 'Repayment' DESC, name LIMIT 1
    `).get() as { id: number } | undefined;
    if (!fallback) throw new HttpError(400, 'create an income category first');
    categoryId = fallback.id;
  }

  const description = debt.description ? `Repayment: ${debt.description}` : 'Repayment';
  db.prepare(`
    INSERT INTO transactions (month, date, type, party, description, amount, category_id, offset_category_id, debt_id)
    VALUES (?, ?, 'income', ?, ?, ?, ?, ?, ?)
  `).run(month, date, debt.person, description, amount, categoryId, debt.categoryId, debt.id);
  res.status(201).json(getDebt(debt.id));
});

debtsRouter.get('/budget-month', (req, res) => {
  const date = String(req.query.date ?? '');
  if (!DATE_RE.test(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
  res.json({ month: guessBudgetMonth(date) });
});
