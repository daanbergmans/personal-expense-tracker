import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { db, dbPath } from './db';
import { buildPayees, type HistoryRow } from './payees';
import { createBackup, listBackups, startDailyBackups } from './backups';
import { exportCsv, exportXlsx } from './export';
import { monthlyTotals, paymentHistory, searchTransactions } from './reports';
import type { QuickPayment } from '../shared/patterns';
import { asId, asName, asType, categoryType, DATE_RE, HttpError, MONTH_RE, type TxType } from './validate';
import { debtCategory, debtsRouter, parseDebtLink } from './debts';

/**
 * The expense category an income entry pays back (or null). Only income can pay something back,
 * and only into an expense category.
 */
function parseOffset(body: Record<string, unknown>, type: TxType, current: number | null | undefined): number | null {
  const raw = 'offsetCategoryId' in body ? body.offsetCategoryId : (current ?? null);
  if (raw === null || raw === undefined || raw === '') return null;
  const id = asId(raw);
  if (type !== 'income') throw new HttpError(400, 'only income can pay back an expense');
  if (categoryType(id) !== 'expense') throw new HttpError(400, 'an entry can only pay back an expense category');
  return id;
}

/** Validates a full transaction payload; for updates, missing fields fall back to `current`. */
function parseTransaction(body: Record<string, unknown>, current?: TransactionRow) {
  const month = body.month ?? current?.month;
  const date = body.date ?? current?.date;
  const amount = body.amount ?? current?.amount;
  const categoryId = asId(body.categoryId ?? current?.category_id);
  const type = categoryType(categoryId);

  if (typeof month !== 'string' || !MONTH_RE.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
  if (!Number.isInteger(amount) || (amount as number) <= 0) throw new HttpError(400, 'amount must be a positive number of cents');
  if (body.type !== undefined && asType(body.type) !== type) throw new HttpError(400, 'category does not match transaction type');
  const debtId = parseDebtLink(body, type, current?.debt_id);

  return {
    month,
    date,
    type,
    party: String(body.party ?? current?.party ?? '').trim(),
    description: String(body.description ?? current?.description ?? '').trim(),
    amount: amount as number,
    categoryId,
    // repaying a debt reduces the debt's expense category, if it has one
    offsetCategoryId: (debtId && debtCategory(debtId)) || parseOffset(body, type, current?.offset_category_id),
    debtId,
  };
}

interface TransactionRow {
  id: number;
  month: string;
  date: string;
  type: TxType;
  party: string;
  description: string;
  amount: number;
  category_id: number;
  offset_category_id: number | null;
  debt_id: number | null;
}

const toTransaction = (row: TransactionRow) => ({
  id: row.id,
  month: row.month,
  date: row.date,
  type: row.type,
  party: row.party,
  description: row.description,
  amount: row.amount,
  categoryId: row.category_id,
  offsetCategoryId: row.offset_category_id,
  debtId: row.debt_id,
});

const app = express();
app.use(express.json({ limit: '5mb' })); // CSV imports can be large

// --- Categories ---

app.get('/api/categories', (_req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.type, c.is_saving AS isSaving, COUNT(t.id) AS usage
    FROM categories c LEFT JOIN transactions t ON t.category_id = c.id
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all();
  res.json((rows as { isSaving: number }[]).map((r) => ({ ...r, isSaving: !!r.isSaving })));
});

app.post('/api/categories', (req, res) => {
  const name = asName((req.body ?? {}).name);
  const type = asType((req.body ?? {}).type);
  try {
    const { lastInsertRowid } = db.prepare('INSERT INTO categories (name, type) VALUES (?, ?)').run(name, type);
    res.status(201).json({ id: Number(lastInsertRowid), name, type, isSaving: false, usage: 0 });
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, `"${name}" already exists`);
    throw err;
  }
});

/** Renames a category and/or sets whether it counts as saving (expense categories only). */
app.patch('/api/categories/:id', (req, res) => {
  const id = asId(req.params.id);
  const body = req.body ?? {};
  const type = categoryType(id);
  if (body.isSaving !== undefined) {
    if (typeof body.isSaving !== 'boolean') throw new HttpError(400, 'isSaving must be true or false');
    if (body.isSaving && type !== 'expense') throw new HttpError(400, 'only expense categories can count as saving');
    db.prepare('UPDATE categories SET is_saving = ? WHERE id = ?').run(body.isSaving ? 1 : 0, id);
  }
  if (body.name !== undefined) {
    const name = asName(body.name);
    try {
      db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
    } catch (err) {
      if (String(err).includes('UNIQUE')) throw new HttpError(409, `"${name}" already exists`);
      throw err;
    }
  }
  res.status(204).end();
});

app.delete('/api/categories/:id', (req, res) => {
  const id = asId(req.params.id);
  const { usage } = db.prepare('SELECT COUNT(*) AS usage FROM transactions WHERE category_id = ?').get(id) as { usage: number };
  if (usage > 0) throw new HttpError(409, `category is used by ${usage} transaction(s)`);
  const { saved } = db.prepare('SELECT COUNT(*) AS saved FROM quick_payments WHERE category_id = ? OR offset_category_id = ?').get(id, id) as { saved: number };
  if (saved > 0) throw new HttpError(409, `category is used by ${saved} saved frequent payment(s)`);
  const { repaid } = db.prepare('SELECT COUNT(*) AS repaid FROM transactions WHERE offset_category_id = ?').get(id) as { repaid: number };
  if (repaid > 0) throw new HttpError(409, `${repaid} repayment(s) are linked to this category`);
  const { debts } = db.prepare('SELECT COUNT(*) AS debts FROM debts WHERE category_id = ?').get(id) as { debts: number };
  if (debts > 0) throw new HttpError(409, `${debts} debt(s) owed to you use this category`);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.status(204).end();
});

// --- Transactions ---

app.get('/api/transactions', (req, res) => {
  const month = String(req.query.month ?? '');
  if (!MONTH_RE.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
  const rows = db.prepare('SELECT * FROM transactions WHERE month = ? ORDER BY date, id').all(month) as unknown as TransactionRow[];
  res.json(rows.map(toTransaction));
});

app.post('/api/transactions', (req, res) => {
  const tx = parseTransaction(req.body ?? {});
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO transactions (month, date, type, party, description, amount, category_id, offset_category_id, debt_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tx.month, tx.date, tx.type, tx.party, tx.description, tx.amount, tx.categoryId, tx.offsetCategoryId, tx.debtId);
  res.status(201).json({ id: Number(lastInsertRowid), ...tx });
});

/**
 * Imports many transactions at once, all or nothing. Each row has either a `categoryId`
 * or a `categoryName` (+ `type`); unknown category names are created.
 */
app.post('/api/transactions/bulk', (req, res) => {
  const rows = (req.body ?? {}).rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(400, 'rows must be a non-empty array');

  const findCategory = db.prepare('SELECT id FROM categories WHERE name = ? AND type = ?');
  const insertCategory = db.prepare('INSERT INTO categories (name, type) VALUES (?, ?)');
  const insert = db.prepare(`
    INSERT INTO transactions (month, date, type, party, description, amount, category_id, offset_category_id, debt_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let createdCategories = 0;

  db.exec('BEGIN');
  try {
    rows.forEach((row: Record<string, unknown>, i) => {
      try {
        let categoryId = row.categoryId;
        if (categoryId === undefined) {
          const name = asName(row.categoryName);
          const type = asType(row.type);
          const found = findCategory.get(name, type) as { id: number } | undefined;
          if (found) {
            categoryId = found.id;
          } else {
            categoryId = Number(insertCategory.run(name, type).lastInsertRowid);
            createdCategories++;
          }
        }
        const tx = parseTransaction({ ...row, categoryId });
        insert.run(tx.month, tx.date, tx.type, tx.party, tx.description, tx.amount, tx.categoryId, tx.offsetCategoryId, tx.debtId);
      } catch (err) {
        if (err instanceof HttpError) throw new HttpError(err.status, `Row ${i + 1}: ${err.message}`);
        throw err;
      }
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(201).json({ imported: rows.length, createdCategories });
});

app.patch('/api/transactions/:id', (req, res) => {
  const id = asId(req.params.id);
  const current = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow | undefined;
  if (!current) throw new HttpError(404, 'transaction not found');
  const tx = parseTransaction(req.body ?? {}, current);
  db.prepare(`
    UPDATE transactions
    SET month = ?, date = ?, type = ?, party = ?, description = ?, amount = ?, category_id = ?, offset_category_id = ?, debt_id = ?
    WHERE id = ?
  `).run(tx.month, tx.date, tx.type, tx.party, tx.description, tx.amount, tx.categoryId, tx.offsetCategoryId, tx.debtId, id);
  res.json({ id, ...tx });
});

app.delete('/api/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(asId(req.params.id));
  res.status(204).end();
});

// --- Saved quick payments ---

const QUICK_PAYMENT_COLUMNS = `
  id, kind, type, party, description, amount, category_id AS categoryId,
  day, month_offset AS monthOffset, offset_category_id AS offsetCategoryId
`;

const allQuickPayments = () =>
  db.prepare(`SELECT ${QUICK_PAYMENT_COLUMNS} FROM quick_payments ORDER BY kind, month_offset, day, party COLLATE NOCASE`)
    .all() as unknown as QuickPayment[];

/** Validates a quick payment payload; for updates, missing fields fall back to `current`. */
function parseQuickPayment(body: Record<string, unknown>, current?: QuickPayment) {
  const kind = body.kind ?? current?.kind;
  if (kind !== 'monthly' && kind !== 'frequent') throw new HttpError(400, 'kind must be "monthly" or "frequent"');
  const categoryId = asId(body.categoryId ?? current?.categoryId);
  const type = categoryType(categoryId);
  if (body.type !== undefined && asType(body.type) !== type) throw new HttpError(400, 'category does not match type');
  // null means "varies": the amount is filled in each time it's added
  const amount = 'amount' in body ? body.amount : (current?.amount ?? null);
  if (amount !== null && (!Number.isInteger(amount) || (amount as number) <= 0)) {
    throw new HttpError(400, 'amount must be a positive number of cents, or null when it varies');
  }
  const party = String(body.party ?? current?.party ?? '').trim();
  const description = String(body.description ?? current?.description ?? '').trim();
  if (!party && !description) throw new HttpError(400, 'who or description is required');

  let day: number | null = null;
  let monthOffset = 0;
  if (kind === 'monthly') {
    const rawDay = 'day' in body ? body.day : (current?.day ?? null); // null means the day varies
    day = rawDay === null ? null : Number(rawDay);
    monthOffset = Number(body.monthOffset ?? current?.monthOffset ?? 0);
    if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) throw new HttpError(400, 'day must be between 1 and 31, or null when it varies');
    if (monthOffset !== 0 && monthOffset !== -1) throw new HttpError(400, 'monthOffset must be 0 or -1');
  }
  const offsetCategoryId = parseOffset(body, type, current?.offsetCategoryId);
  return { kind, type, party, description, amount: amount as number | null, categoryId, day, monthOffset, offsetCategoryId };
}

app.get('/api/quick-payments', (_req, res) => {
  res.json(allQuickPayments());
});

app.post('/api/quick-payments', (req, res) => {
  const p = parseQuickPayment(req.body ?? {});
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO quick_payments (kind, type, party, description, amount, category_id, day, month_offset, offset_category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.kind, p.type, p.party, p.description, p.amount, p.categoryId, p.day, p.monthOffset, p.offsetCategoryId);
  res.status(201).json({ id: Number(lastInsertRowid), ...p });
});

app.patch('/api/quick-payments/:id', (req, res) => {
  const id = asId(req.params.id);
  const current = db.prepare(`SELECT ${QUICK_PAYMENT_COLUMNS} FROM quick_payments WHERE id = ?`).get(id) as QuickPayment | undefined;
  if (!current) throw new HttpError(404, 'payment not found');
  const p = parseQuickPayment(req.body ?? {}, current);
  db.prepare(`
    UPDATE quick_payments
    SET kind = ?, type = ?, party = ?, description = ?, amount = ?, category_id = ?, day = ?, month_offset = ?, offset_category_id = ?
    WHERE id = ?
  `).run(p.kind, p.type, p.party, p.description, p.amount, p.categoryId, p.day, p.monthOffset, p.offsetCategoryId, id);
  res.json({ id, ...p });
});

/** Latest and recent amounts of each saved payment in your history (price changes, estimates). */
app.get('/api/quick-payments/history', (_req, res) => {
  res.json(paymentHistory(allQuickPayments()));
});

app.delete('/api/quick-payments/:id', (req, res) => {
  db.prepare('DELETE FROM quick_payments WHERE id = ?').run(asId(req.params.id));
  res.status(204).end();
});

/** Known counterparties with their latest details, for autofilling the add row. */
app.get('/api/payees', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, date, type, party, description, amount, category_id AS categoryId FROM transactions
  `).all() as unknown as HistoryRow[];
  res.json(buildPayees(rows, allQuickPayments()));
});

// --- Overview ---

app.get('/api/years', (_req, res) => {
  const rows = db.prepare('SELECT DISTINCT substr(month, 1, 4) AS year FROM transactions').all() as { year: string }[];
  const years = new Set(rows.map((r) => Number(r.year)));
  years.add(new Date().getFullYear());
  res.json([...years].sort());
});

/** Net totals per category per month (1-12) for one year; repayments reduce the expense they pay back. */
app.get('/api/summary', (req, res) => {
  const year = Number(req.query.year);
  if (!Number.isInteger(year)) throw new HttpError(400, 'year is required');
  res.json(monthlyTotals(`${year}-`).map((r) => ({ categoryId: r.categoryId, month: Number(r.month.slice(5, 7)), total: r.total })));
});

/** Net totals per category for every budget month, for trends and averages. */
app.get('/api/totals', (_req, res) => {
  res.json(monthlyTotals());
});

app.get('/api/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const type = req.query.type ? asType(req.query.type) : undefined;
  const categoryId = req.query.categoryId ? asId(req.query.categoryId) : undefined;
  const year = req.query.year ? Number(req.query.year) : undefined;
  if (year !== undefined && !Number.isInteger(year)) throw new HttpError(400, 'invalid year');
  res.json(searchTransactions({ q, type, categoryId, year }));
});

// --- Export & backups ---

const stamp = () => new Date().toISOString().slice(0, 10);

app.get('/api/export.csv', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="expenses-${stamp()}.csv"`);
  res.send(exportCsv());
});

app.get('/api/export.xlsx', async (_req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="expenses-${stamp()}.xlsx"`);
  res.send(await exportXlsx());
});

app.get('/api/backups', (_req, res) => {
  res.json(listBackups());
});

app.post('/api/backups', (_req, res) => {
  res.status(201).json(createBackup(false));
});

app.use('/api', debtsRouter);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not found')));

// --- Static frontend (production build) ---

const distDir = path.resolve('dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, '127.0.0.1', () => {
  console.log(`Expense tracker running at http://localhost:${port}`);
  console.log(`Data stored in ${dbPath}`);
});
startDailyBackups();
