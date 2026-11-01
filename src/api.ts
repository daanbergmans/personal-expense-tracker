import type { Payee, QuickPayment } from '../shared/patterns';

export type { PaymentKind, Payee, QuickPayment } from '../shared/patterns';

export type QuickPaymentInput = Omit<QuickPayment, 'id' | 'type'>;

export type TxType = 'income' | 'expense';

export interface Category {
  id: number;
  name: string;
  type: TxType;
  /** Expense categories only: money put aside (investing, savings) rather than spent. */
  isSaving: boolean;
  usage: number;
}

export interface Transaction {
  id: number;
  month: string; // YYYY-MM budget month
  date: string; // YYYY-MM-DD
  type: TxType;
  party: string;
  description: string;
  amount: number; // cents
  categoryId: number;
  /** Income only: the expense category this pays back, which it then reduces instead of counting as income. */
  offsetCategoryId: number | null;
  /** Income only: the debt (money owed to you) this repays. */
  debtId: number | null;
}

export type TransactionInput = Omit<Transaction, 'id' | 'type' | 'offsetCategoryId' | 'debtId'> & {
  offsetCategoryId?: number | null;
  debtId?: number | null;
};

/** A row for bulk import: either an existing category id or a category name to match/create. */
export type ImportRow = Omit<Transaction, 'id' | 'categoryId' | 'offsetCategoryId' | 'debtId'> & ({ categoryId: number } | { categoryName: string });

export interface SummaryRow {
  categoryId: number;
  month: number; // 1-12
  total: number; // cents
}

/** Net total for one category in one budget month (repayments already subtracted). */
export interface TotalRow {
  month: string; // YYYY-MM
  categoryId: number;
  total: number; // cents
}

export interface PaymentHistory {
  id: number;
  lastAmount: number | null;
  lastDate: string | null;
  recentAverage: number | null;
}

export interface SearchResult {
  count: number;
  income: number;
  expense: number;
  limited: boolean;
  rows: Transaction[];
}

export type DebtStatus = 'open' | 'partial' | 'repaid' | 'settled';

/** Money someone owes you. */
export interface Debt {
  id: number;
  person: string;
  description: string;
  amount: number; // cents owed
  date: string;
  /** Expense category a repayment reduces. */
  categoryId: number | null;
  /** The outgoing entry you paid, if the debt came from one. */
  expenseTransactionId: number | null;
  expenseMonth: string | null;
  settledAt: string | null;
  settledNote: string;
  repaid: number;
  remaining: number;
  status: DebtStatus;
  repayments: { id: number; date: string; month: string; amount: number }[];
}

export interface DebtInput {
  person: string;
  description: string;
  amount: number;
  date: string;
  categoryId: number | null;
  expenseTransactionId?: number | null;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  automatic: boolean;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  categories: () => request<Category[]>('GET', '/api/categories'),
  createCategory: (name: string, type: TxType) => request<Category>('POST', '/api/categories', { name, type }),
  renameCategory: (id: number, name: string) => request<void>('PATCH', `/api/categories/${id}`, { name }),
  setCategorySaving: (id: number, isSaving: boolean) => request<void>('PATCH', `/api/categories/${id}`, { isSaving }),
  deleteCategory: (id: number) => request<void>('DELETE', `/api/categories/${id}`),

  transactions: (month: string) => request<Transaction[]>('GET', `/api/transactions?month=${month}`),
  createTransaction: (tx: TransactionInput) => request<Transaction>('POST', '/api/transactions', tx),
  updateTransaction: (id: number, tx: Partial<TransactionInput>) => request<Transaction>('PATCH', `/api/transactions/${id}`, tx),
  deleteTransaction: (id: number) => request<void>('DELETE', `/api/transactions/${id}`),
  importTransactions: (rows: ImportRow[]) =>
    request<{ imported: number; createdCategories: number }>('POST', '/api/transactions/bulk', { rows }),
  search: (params: { q: string; type?: TxType; categoryId?: number; year?: number }) => {
    const query = new URLSearchParams({ q: params.q });
    if (params.type) query.set('type', params.type);
    if (params.categoryId) query.set('categoryId', String(params.categoryId));
    if (params.year) query.set('year', String(params.year));
    return request<SearchResult>('GET', `/api/search?${query}`);
  },

  quickPayments: () => request<QuickPayment[]>('GET', '/api/quick-payments'),
  createQuickPayment: (p: QuickPaymentInput) => request<QuickPayment>('POST', '/api/quick-payments', p),
  updateQuickPayment: (id: number, p: Partial<QuickPaymentInput>) => request<QuickPayment>('PATCH', `/api/quick-payments/${id}`, p),
  deleteQuickPayment: (id: number) => request<void>('DELETE', `/api/quick-payments/${id}`),
  paymentHistory: () => request<PaymentHistory[]>('GET', '/api/quick-payments/history'),

  payees: () => request<Payee[]>('GET', '/api/payees'),

  years: () => request<number[]>('GET', '/api/years'),
  summary: (year: number) => request<SummaryRow[]>('GET', `/api/summary?year=${year}`),
  totals: () => request<TotalRow[]>('GET', '/api/totals'),

  debts: () => request<Debt[]>('GET', '/api/debts'),
  createDebt: (d: DebtInput) => request<Debt>('POST', '/api/debts', d),
  updateDebt: (id: number, d: Partial<DebtInput> & { settled?: boolean; settledNote?: string }) =>
    request<Debt>('PATCH', `/api/debts/${id}`, d),
  deleteDebt: (id: number) => request<void>('DELETE', `/api/debts/${id}`),
  repayDebt: (id: number, r: { amount: number; date: string; month: string; categoryId?: number }) =>
    request<Debt>('POST', `/api/debts/${id}/repayments`, r),
  budgetMonth: (date: string) => request<{ month: string }>('GET', `/api/budget-month?date=${date}`),

  backups: () => request<BackupInfo[]>('GET', '/api/backups'),
  createBackup: () => request<BackupInfo>('POST', '/api/backups'),
};
