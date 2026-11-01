import { useState } from 'react';
import { patternKey, paymentDate } from '../../shared/patterns';
import type { Category, QuickPayment, Transaction, TransactionInput } from '../api';
import { formatDate, formatMoney } from '../format';

interface Props {
  month: string;
  payments: QuickPayment[];
  transactions: Transaction[];
  categories: Category[];
  onAdd: (input: TransactionInput) => Promise<void>;
  /** Fill the add row with a payment so the user can complete or adjust it before saving. */
  onPick: (payment: QuickPayment, date: string | null) => void;
}

function readOpen() {
  try {
    return localStorage.getItem('quickAddOpen') !== '0';
  } catch {
    return true;
  }
}

export function QuickAdd({ month, payments, transactions, categories, onAdd, onPick }: Props) {
  const [open, setOpen] = useState(readOpen);
  const [adding, setAdding] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const monthly = payments
    .filter((p) => p.kind === 'monthly')
    // without a fixed day, start from the 1st of the right month so only the day needs typing
    .map((p) => ({ ...p, date: paymentDate(month, p.day ?? 1, p.monthOffset) }))
    .sort((a, b) => (a.type === b.type ? a.date.localeCompare(b.date) : a.type === 'income' ? -1 : 1));
  const frequent = payments.filter((p) => p.kind === 'frequent');

  const present = new Set(transactions.map(patternKey));
  const missing = monthly.filter((p) => !present.has(patternKey(p)));
  // only payments with a fixed amount and day can be added without input
  const isReady = (p: QuickPayment) => p.amount !== null && p.day !== null;
  const ready = missing.filter(isReady);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  function toggle() {
    setOpen(!open);
    try {
      localStorage.setItem('quickAddOpen', open ? '0' : '1');
    } catch {
      // storage unavailable: the panel just won't remember its state
    }
  }

  async function add(items: typeof monthly) {
    setAdding(new Set(items.map((p) => p.id)));
    setError(null);
    try {
      for (const p of items) {
        await onAdd({
          month, date: p.date, party: p.party, description: p.description, amount: p.amount!,
          categoryId: p.categoryId, offsetCategoryId: p.offsetCategoryId,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(new Set());
    }
  }

  if (payments.length === 0) {
    return (
      <section className="card quick-add quick-add-empty">
        <span className="muted-text">
          Save your rent, salary, subscriptions and other regular payments on the{' '}
          <a href="#/payments">Frequent payments</a> tab to add them here in one click.
        </span>
      </section>
    );
  }

  return (
    <section className="card quick-add">
      <header className="quick-add-header">
        <button className="quick-add-toggle" onClick={toggle} aria-expanded={open}>
          <span className={`caret ${open ? 'open' : ''}`}>›</span>
          <h2>Quick add</h2>
        </button>
        <span className="muted-text">
          {monthly.length > 0 && (missing.length ? `${missing.length} of ${monthly.length} monthly payments not added yet` : 'All monthly payments added')}
        </span>
        <a className="manage-link" href="#/payments">Manage</a>
        {ready.length > 1 && (
          <button
            className="btn small"
            onClick={() => add(ready)}
            disabled={adding.size > 0}
            title={ready.length < missing.length ? 'Payments with a varying amount or day need to be filled in one by one' : undefined}
          >
            {ready.length === missing.length ? `Add all ${ready.length} missing` : `Add ${ready.length} fixed payments`}
          </button>
        )}
      </header>

      {open && (
        <div className="quick-add-body">
          {monthly.length > 0 && (
            <div>
              <h3>Monthly</h3>
              <ul className="recurring-list">
                {monthly.map((p) => {
                  const added = present.has(patternKey(p));
                  return (
                    <li key={p.id} className={added ? 'added' : ''}>
                      <span className={`type-badge ${p.type}`}>{p.type === 'income' ? 'In' : 'Out'}</span>
                      <span className="recurring-name">
                        <span className="recurring-party">{p.party || p.description}</span>
                        <span className="recurring-details">
                          {categoryName.get(p.categoryId) ?? '?'}
                          {p.party && p.description && ` · ${p.description}`}
                        </span>
                      </span>
                      <span className="muted-text recurring-date">
                        {p.day === null ? <span className="varies" title={p.monthOffset === -1 ? 'Day varies, in the month before' : 'Day varies'}>Day varies</span> : formatDate(p.date)}
                      </span>
                      <span className="num">{p.amount === null ? <span className="varies">Varies</span> : formatMoney(p.amount)}</span>
                      <span className="recurring-action">
                        {added ? (
                          <span className="added-label">✓ Added</span>
                        ) : isReady(p) ? (
                          <>
                            <button className="icon-btn small" title="Adjust before adding" onClick={() => onPick(p, p.date)}>✎</button>
                            <button className="btn small" onClick={() => add([p])} disabled={adding.size > 0}>
                              {adding.has(p.id) ? 'Adding…' : 'Add'}
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn small"
                            title={p.amount === null ? 'Fill in the add row, then type the amount' : 'Fill in the add row, then set the date'}
                            onClick={() => onPick(p, p.date)}
                          >
                            Fill in
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {frequent.length > 0 && (
            <div>
              <h3>Frequent</h3>
              <div className="quick-chips">
                {frequent.map((p) => (
                  <button key={p.id} className={`quick-chip ${p.type}`} title="Fill in the add row" onClick={() => onPick(p, null)}>
                    <span>{p.party || p.description}</span>
                    <span className="muted-text">{categoryName.get(p.categoryId) ?? '?'}</span>
                    {p.amount !== null && <strong>{formatMoney(p.amount)}</strong>}
                  </button>
                ))}
              </div>
              <p className="muted-text small">Click to fill in the add row, adjust if needed, then press Enter.</p>
            </div>
          )}

          {error && <p className="row-error">{error}</p>}
        </div>
      )}
    </section>
  );
}
