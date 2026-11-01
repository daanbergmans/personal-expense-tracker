import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
mkdirSync(dataDir, { recursive: true });

export const dbPath = path.join(dataDir, 'expenses.db');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    UNIQUE (name, type)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY,
    month       TEXT NOT NULL,             -- budget month (YYYY-MM) the entry counts towards
    date        TEXT NOT NULL,             -- actual date (YYYY-MM-DD), may fall outside the month
    type        TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    party       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    amount      INTEGER NOT NULL,          -- cents
    category_id INTEGER NOT NULL REFERENCES categories (id)
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_month ON transactions (month);

  -- payments saved for quick adding: 'monthly' ones are proposed each month, 'frequent' ones are one-click fills
  CREATE TABLE IF NOT EXISTS quick_payments (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('monthly', 'frequent')),
    type         TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    party        TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    amount       INTEGER,                   -- cents; NULL = varies, filled in when adding
    category_id  INTEGER NOT NULL REFERENCES categories (id),
    day          INTEGER,                   -- monthly only: day of month it is paid; NULL = varies
    month_offset INTEGER NOT NULL DEFAULT 0 -- monthly only: -1 = paid in the month before the budget month
  );

  -- leftovers from automatic payment detection, which has been removed
  DROP TABLE IF EXISTS hidden_suggestions;
`);

const hasColumn = (table: string, column: string) =>
  (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).some((c) => c.name === column);

// older databases still have the column that linked saved payments to detected ones
if (hasColumn('quick_payments', 'source_key')) db.exec('ALTER TABLE quick_payments DROP COLUMN source_key');

// older databases require an amount; SQLite can't drop NOT NULL in place, so rebuild the table
const amountColumn = db.prepare("SELECT \"notnull\" AS required FROM pragma_table_info('quick_payments') WHERE name = 'amount'").get() as { required: number };
if (amountColumn.required) {
  db.exec(`
    BEGIN;
    CREATE TABLE quick_payments_new (
      id           INTEGER PRIMARY KEY,
      kind         TEXT NOT NULL CHECK (kind IN ('monthly', 'frequent')),
      type         TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      party        TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL DEFAULT '',
      amount       INTEGER,
      category_id  INTEGER NOT NULL REFERENCES categories (id),
      day          INTEGER,
      month_offset INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO quick_payments_new (id, kind, type, party, description, amount, category_id, day, month_offset)
      SELECT id, kind, type, party, description, amount, category_id, day, month_offset FROM quick_payments;
    DROP TABLE quick_payments;
    ALTER TABLE quick_payments_new RENAME TO quick_payments;
    COMMIT;
  `);
}

// expense categories that count as saving/investing rather than spending
if (!hasColumn('categories', 'is_saving')) {
  db.exec(`
    ALTER TABLE categories ADD COLUMN is_saving INTEGER NOT NULL DEFAULT 0;
    UPDATE categories SET is_saving = 1 WHERE type = 'expense' AND name IN ('Investing', 'Savings');
  `);
}

// an income entry that pays back an expense (a friend's share of dinner) reduces that expense category instead
for (const table of ['transactions', 'quick_payments']) {
  if (!hasColumn(table, 'offset_category_id')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN offset_category_id INTEGER REFERENCES categories (id)`);
  }
}

// money people owe you; repayments are income entries pointing at the debt
db.exec(`
  CREATE TABLE IF NOT EXISTS debts (
    id                     INTEGER PRIMARY KEY,
    person                 TEXT NOT NULL,
    description            TEXT NOT NULL DEFAULT '',
    amount                 INTEGER NOT NULL,   -- cents owed
    date                   TEXT NOT NULL,      -- YYYY-MM-DD the debt started
    category_id            INTEGER REFERENCES categories (id),  -- expense category a repayment reduces
    expense_transaction_id INTEGER REFERENCES transactions (id) ON DELETE SET NULL,  -- what you paid, if any
    settled_at             TEXT,               -- set when closed without (full) repayment, e.g. paid in cash
    settled_note           TEXT NOT NULL DEFAULT ''
  );
`);
if (!hasColumn('transactions', 'debt_id')) {
  db.exec('ALTER TABLE transactions ADD COLUMN debt_id INTEGER REFERENCES debts (id) ON DELETE SET NULL');
}

const defaultCategories = {
  income: ['Allowance', 'Refund', 'Repayment', 'Reward', 'Salary', 'Selling', 'Transfer'],
  expense: [
    'Apartment', 'Bank fees', 'Breakfast', 'Clothing', 'Dates', 'Dinner', 'Drinks',
    'Entertainment', 'Events & Activities', 'Games', 'Gifts', 'Groceries', 'Insurance',
    'Investing', 'Lunch', 'Materialistic Purchases', 'Misc', 'Pet Purchases', 'Relationship',
    'Rent', 'Savings', 'Snacks', 'Sports', 'Subscriptions', 'Utilities',
  ],
};

const { count } = db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number };
if (count === 0) {
  const insert = db.prepare('INSERT INTO categories (name, type, is_saving) VALUES (?, ?, ?)');
  for (const [type, names] of Object.entries(defaultCategories)) {
    for (const name of names) insert.run(name, type, name === 'Investing' || name === 'Savings' ? 1 : 0);
  }
}
