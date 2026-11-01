import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { monthIndex, patternKey } from '../../shared/patterns';
import {
  api, type Category, type Debt, type DebtInput, type Payee, type PaymentHistory, type QuickPayment, type TotalRow,
  type Transaction, type TransactionInput, type TxType,
} from '../api';
import { CategoryComparison } from '../components/CategoryComparison';
import { QuickAdd } from '../components/QuickAdd';
import { centsToInput, formatDate, formatMoney, formatPercent, monthKey, monthLabel, parseAmount, shiftMonth, todayIso } from '../format';
import { averagesBefore, netByCategory, splitFromTotals } from '../insights';

interface Props {
  month: string;
  categories: Category[];
  /** Called after any change so category usage counts can refresh. */
  onChange: () => void;
}

const byDate = (a: Transaction, b: Transaction) => a.date.localeCompare(b.date) || a.id - b.id;

/** Values pushed into a panel's add row; a new object each time so the row reacts to repeated picks. */
interface Prefill {
  type: TxType;
  values: Partial<Draft>;
  /** Field to put the cursor in: the one the user still has to fill in or check. */
  focus: 'date' | 'amount';
}

export function MonthPage({ month, categories, onChange }: Props) {
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickPayments, setQuickPayments] = useState<QuickPayment[] | null>(null);
  const [history, setHistory] = useState<PaymentHistory[]>([]);
  const [totals, setTotals] = useState<TotalRow[] | null>(null);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);

  const loadDebts = () => api.debts().then(setDebts, (e: Error) => setError(e.message));

  useEffect(() => {
    loadDebts();
    api.quickPayments().then(setQuickPayments, (e: Error) => setError(e.message));
    api.paymentHistory().then(setHistory, (e: Error) => setError(e.message));
    api.totals().then(setTotals, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setPrefill(null);
    api.payees().then(setPayees, (e: Error) => setError(e.message));
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    setTransactions(null);
    api.transactions(month).then(
      (rows) => !cancelled && setTransactions(rows),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [month]);

  async function create(input: TransactionInput) {
    const tx = await api.createTransaction(input);
    setTransactions((list) => [...(list ?? []), tx].sort(byDate));
    if (tx.debtId) loadDebts();
    onChange();
  }

  async function update(id: number, input: TransactionInput) {
    const tx = await api.updateTransaction(id, input);
    setTransactions((list) => (list ?? []).filter((t) => t.id !== id).concat(tx.month === month ? [tx] : []).sort(byDate));
    loadDebts();
    onChange();
  }

  async function createDebt(input: DebtInput) {
    await api.createDebt(input);
    await loadDebts();
  }

  async function remove(tx: Transaction) {
    if (!confirm(`Delete "${tx.party || tx.description || formatMoney(tx.amount)}"?`)) return;
    try {
      await api.deleteTransaction(tx.id);
      setTransactions((list) => (list ?? []).filter((t) => t.id !== tx.id));
      loadDebts();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Fill the add row with a saved payment; `date` is set for monthly payments. */
  function pick(p: QuickPayment, date: string | null) {
    const values: Partial<Draft> = {
      party: p.party,
      description: p.description,
      amount: p.amount === null ? '' : centsToInput(p.amount),
      categoryId: String(p.categoryId),
      offsetCategoryId: p.offsetCategoryId ? String(p.offsetCategoryId) : '',
    };
    if (date) values.date = date;
    // a monthly payment without a fixed day needs its date checked first, otherwise the amount
    const focus = date && p.kind === 'monthly' && p.day === null ? 'date' : 'amount';
    setPrefill({ type: p.type, values, focus });
  }

  const income = transactions?.filter((t) => t.type === 'income') ?? [];
  const expenses = transactions?.filter((t) => t.type === 'expense') ?? [];
  const monthTotals = netByCategory(transactions ?? []);
  const split = splitFromTotals(monthTotals, categories);

  // forecast: monthly payments not in this month yet; varying amounts are estimated from recent ones
  const now = new Date();
  const showForecast = monthIndex(month) >= monthIndex(monthKey(now.getFullYear(), now.getMonth() + 1));
  const present = new Set((transactions ?? []).map(patternKey));
  const historyById = new Map(history.map((h) => [h.id, h]));
  let comingIn = 0;
  let goingOut = 0;
  let estimated = false;
  for (const p of quickPayments ?? []) {
    if (p.kind !== 'monthly' || present.has(patternKey(p))) continue;
    const amount = p.amount ?? historyById.get(p.id)?.recentAverage ?? null;
    if (amount === null) continue;
    if (p.amount === null) estimated = true;
    if (p.type === 'income') comingIn += amount;
    else goingOut += amount;
  }
  const expected = split.left + comingIn - goingOut;

  const { averages, months: averageMonths } = totals ? averagesBefore(totals, month) : { averages: new Map(), months: [] };

  return (
    <div className="month-page">
      <div className="page-header">
        <div className="pager">
          <a className="icon-btn" href={`#/month/${shiftMonth(month, -1)}`} aria-label="Previous month">‹</a>
          <h1>{monthLabel(month)}</h1>
          <a className="icon-btn" href={`#/month/${shiftMonth(month, 1)}`} aria-label="Next month">›</a>
        </div>
        <div className="stat-tiles">
          <div className="stat-tile" title="Income, not counting repayments (those reduce what they pay back)">
            <span className="stat-label">Income</span>
            <span className="stat-value">{formatMoney(split.income)}</span>
          </div>
          <div className="stat-tile" title="Spending after repayments, without saving and investing">
            <span className="stat-label">Spent</span>
            <span className="stat-value">{formatMoney(split.spent)}</span>
          </div>
          <div className="stat-tile" title="Put into categories that count as saving (see Categories)">
            <span className="stat-label">Saved &amp; invested</span>
            <span className="stat-value">{formatMoney(split.saved)}</span>
          </div>
          <div className="stat-tile" title="Income minus spending, saving and investing">
            <span className="stat-label">
              {/* a negative rate early in the month (little income yet) is just noise */}
              Left{split.savingsRate !== null && split.savingsRate >= 0 && <> · {formatPercent(split.income - split.spent, split.income)} not spent</>}
            </span>
            <span className={`stat-value ${split.left < 0 ? 'negative' : 'positive'}`}>{formatMoney(split.left)}</span>
          </div>
          {showForecast && (comingIn > 0 || goingOut > 0) && (
            <div
              className="stat-tile forecast"
              title={`Still expected from your monthly payments: +${formatMoney(comingIn)} in, −${formatMoney(goingOut)} out${estimated ? ' (varying amounts estimated from the last three times)' : ''}`}
            >
              <span className="stat-label">Expected at month end</span>
              <span className={`stat-value ${expected < 0 ? 'negative' : ''}`}>{estimated ? '≈ ' : ''}{formatMoney(expected)}</span>
              <span className="stat-sub">
                {comingIn > 0 && `+${formatMoney(comingIn)} to come`}
                {comingIn > 0 && goingOut > 0 && ' · '}
                {goingOut > 0 && `−${formatMoney(goingOut)} to pay`}
              </span>
            </div>
          )}
        </div>
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}

      {transactions !== null && quickPayments && (
        <QuickAdd
          month={month}
          payments={quickPayments}
          transactions={transactions}
          categories={categories}
          onAdd={create}
          onPick={pick}
        />
      )}

      {transactions === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="panels">
            {(['income', 'expense'] as const).map((type) => (
              <TransactionPanel
                key={`${month}-${type}`}
                type={type}
                month={month}
                transactions={type === 'income' ? income : expenses}
                categories={categories}
                payees={payees.filter((p) => p.type === type)}
                prefill={prefill?.type === type ? prefill : undefined}
                debts={debts}
                onCreateDebt={createDebt}
                onCreate={create}
                onUpdate={update}
                onDelete={remove}
              />
            ))}
          </div>
          {totals && (
            <CategoryComparison
              categories={categories}
              values={monthTotals}
              averages={averages}
              averageMonths={averageMonths}
              title="This month vs your average"
            />
          )}
        </>
      )}
    </div>
  );
}

interface PanelProps {
  type: TxType;
  month: string;
  transactions: Transaction[];
  /** All categories; the panel uses its own type, income rows also pick an expense category they pay back. */
  categories: Category[];
  payees: Payee[];
  prefill?: Prefill;
  /** Money owed to you: outgoing entries can create one, incoming entries can repay one. */
  debts: Debt[];
  onCreateDebt: (input: DebtInput) => Promise<void>;
  onCreate: (input: TransactionInput) => Promise<void>;
  onUpdate: (id: number, input: TransactionInput) => Promise<void>;
  onDelete: (tx: Transaction) => void;
}

const debtLabel = (d: Debt) => `${d.person}${d.description ? ` · ${d.description}` : ''}`;

const STICKY_TOP = 64; // below the 52px top bar, plus a gap
const STICKY_BOTTOM_GAP = 16;

/**
 * Sticky offset that lets the shorter panel glide along while the longer one scrolls. A panel
 * that fits on screen sticks below the top bar; a taller one sticks once its bottom is in view,
 * so its end (with the add row) stays reachable.
 */
function useStickyTop(ref: RefObject<HTMLElement | null>) {
  const [top, setTop] = useState(STICKY_TOP);
  const update = useCallback(() => {
    const el = ref.current;
    if (el) setTop(Math.min(STICKY_TOP, window.innerHeight - el.offsetHeight - STICKY_BOTTOM_GAP));
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref, update]);

  // also after every render (entries added, edit rows opened): React skips the update when nothing changed
  useEffect(update);
  return top;
}

function TransactionPanel({
  type, month, transactions, categories, payees, prefill, debts, onCreateDebt, onCreate, onUpdate, onDelete,
}: PanelProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [owedForId, setOwedForId] = useState<number | null>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const debtById = new Map(debts.map((d) => [d.id, d]));
  const total = transactions.reduce((s, t) => s + t.amount, 0);
  const defaultDate = todayIso().startsWith(month) ? todayIso() : `${month}-01`;
  const panelRef = useRef<HTMLElement>(null);
  const stickyTop = useStickyTop(panelRef);

  return (
    <section ref={panelRef} className={`panel panel-${type} sticky-panel`} style={{ top: stickyTop }}>
      <header className="panel-header">
        <h2>{type === 'income' ? 'Incoming' : 'Outgoing'}</h2>
        <span className="panel-total">{formatMoney(total)}</span>
      </header>
      <datalist id={`payees-${type}`}>
        {payees.map((p) => <option key={p.party} value={p.party} />)}
      </datalist>
      <div className="table-scroll">
        <table className="tx-table">
          <thead>
            <tr>
              <th className="col-date">Date</th>
              <th>{type === 'income' ? 'From' : 'To'}</th>
              <th>Description</th>
              <th className="num col-amount">Amount</th>
              <th className="col-category">Category</th>
              <th className="col-actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">No entries yet.</td>
              </tr>
            )}
            {transactions.map((tx) =>
              tx.id === editingId ? (
                <EditorRow
                  key={tx.id}
                  type={type}
                  month={month}
                  categories={categories}
                  debts={debts}
                  initial={{
                    date: tx.date,
                    party: tx.party,
                    description: tx.description,
                    amount: centsToInput(tx.amount),
                    categoryId: String(tx.categoryId),
                    offsetCategoryId: tx.debtId ? `debt:${tx.debtId}` : tx.offsetCategoryId ? String(tx.offsetCategoryId) : '',
                  }}
                  submitLabel="Save"
                  onSave={async (input) => {
                    await onUpdate(tx.id, input);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <Fragment key={tx.id}>
                  <tr onDoubleClick={() => setEditingId(tx.id)}>
                    <td className="col-date">{formatDate(tx.date)}</td>
                    <td>{tx.party}</td>
                    <td className="muted-text">{tx.description}</td>
                    <td className="num">{formatMoney(tx.amount)}</td>
                    <td>
                      <span className="chip">{categoryName.get(tx.categoryId) ?? '?'}</span>
                      {tx.debtId && debtById.get(tx.debtId) ? (
                        <a className="pays-back" href="#/owed" title="Repays money owed to you">↩ {debtLabel(debtById.get(tx.debtId)!)}</a>
                      ) : tx.offsetCategoryId && (
                        <span className="pays-back" title={`Pays back ${categoryName.get(tx.offsetCategoryId)}: reduces that category instead of counting as income`}>
                          ↩ {categoryName.get(tx.offsetCategoryId) ?? '?'}
                        </span>
                      )}
                      {debts.filter((d) => d.expenseTransactionId === tx.id).map((d) => (
                        <a key={d.id} className={`owed-badge ${d.remaining ? '' : 'done'}`} href="#/owed" title="Money owed to you for this">
                          👥 {d.person} {d.remaining ? `owes ${formatMoney(d.remaining)}` : 'paid back'}
                        </a>
                      ))}
                    </td>
                    <td className="col-actions">
                      {type === 'expense' && (
                        <button className="icon-btn small" title="Someone owes me (part of) this" onClick={() => setOwedForId(owedForId === tx.id ? null : tx.id)}>👥</button>
                      )}
                      <button className="icon-btn small" title="Edit" onClick={() => setEditingId(tx.id)}>✎</button>
                      <button className="icon-btn small danger" title="Delete" onClick={() => onDelete(tx)}>✕</button>
                    </td>
                  </tr>
                  {owedForId === tx.id && (
                    <OwedRow
                      tx={tx}
                      people={[...new Set(debts.map((d) => d.person))]}
                      onSave={async (input) => {
                        await onCreateDebt(input);
                        setOwedForId(null);
                      }}
                      onCancel={() => setOwedForId(null)}
                    />
                  )}
                </Fragment>
              ),
            )}
          </tbody>
          <tfoot>
            <EditorRow
              type={type}
              month={month}
              categories={categories}
              initial={{ date: defaultDate, party: '', description: '', amount: '', categoryId: '', offsetCategoryId: '' }}
              submitLabel="Add"
              resetOnSave
              payees={payees}
              prefill={prefill}
              debts={debts}
              onSave={onCreate}
            />
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** Inline form under an outgoing entry: someone owes you (part of) it. */
function OwedRow({ tx, people, onSave, onCancel }: {
  tx: Transaction;
  people: string[];
  onSave: (input: DebtInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState(centsToInput(Math.round(tx.amount / 2))); // a split bill is the common case
  const [description, setDescription] = useState(tx.description || tx.party);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const cents = parseAmount(amount);
    if (!person.trim()) return setError('Who owes you?');
    if (cents === null) return setError('Enter a valid amount, e.g. 12,50.');
    try {
      await onSave({ person, description, amount: cents, date: tx.date, categoryId: tx.categoryId, expenseTransactionId: tx.id });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <tr
      className="edit-row owed-row"
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        else if (e.key === 'Escape') onCancel();
      }}
    >
      <td colSpan={6}>
        <div className="repayment-form">
          <span className="owed-row-label">👥 Owed to you:</span>
          <input value={person} onChange={(e) => setPerson(e.target.value)} list="owed-people" placeholder="Who" aria-label="Who owes you" autoFocus />
          <datalist id="owed-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
          <input className="num owed-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount owed" />
          <span className="muted-text small-text">of {formatMoney(tx.amount)}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What for" aria-label="What for" />
          <button className="btn primary small" onClick={save}>Save</button>
          <button className="icon-btn small" title="Cancel" onClick={onCancel}>↶</button>
        </div>
        {error && <p className="row-error">{error}</p>}
      </td>
    </tr>
  );
}

interface Draft {
  date: string;
  party: string;
  description: string;
  amount: string;
  categoryId: string;
  /** Income only: '' for nothing, an expense category id it pays back, or "debt:<id>" for money owed to you. */
  offsetCategoryId: string;
}

interface EditorProps {
  type: TxType;
  month: string;
  categories: Category[];
  initial: Draft;
  submitLabel: string;
  resetOnSave?: boolean;
  /** Known counterparties; picking one fills in the empty fields (add row only). */
  payees?: Payee[];
  prefill?: Prefill;
  debts?: Debt[];
  onSave: (input: TransactionInput) => Promise<void>;
  onCancel?: () => void;
}

function EditorRow({ type, month, categories, initial, submitLabel, resetOnSave, payees, prefill, debts = [], onSave, onCancel }: EditorProps) {
  const openDebts = debts.filter((d) => d.status === 'open' || d.status === 'partial');
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  // values filled in from a known payee, so they can be swapped when the payee changes
  const autoFilled = useRef<Partial<Draft>>({});

  const focusAfterPrefill = useRef<Prefill['focus'] | null>(null);

  useEffect(() => {
    if (!prefill) return;
    autoFilled.current = {};
    focusAfterPrefill.current = prefill.focus;
    setDraft((d) => ({ ...d, ...prefill.values }));
    setError(null);
  }, [prefill]);

  // after a prefill renders, focus (and select) the field to fill in so typing replaces it
  useEffect(() => {
    const field = focusAfterPrefill.current;
    if (!field) return;
    focusAfterPrefill.current = null;
    const input = field === 'date' ? dateInput.current : amountInput.current;
    input?.focus();
    if (field === 'amount') input?.select();
  }, [draft]);

  function changeParty(party: string) {
    const next = { ...draft, party };
    if (payees) {
      const fields = ['description', 'amount', 'categoryId'] as const;
      for (const f of fields) if (autoFilled.current[f] !== undefined && next[f] === autoFilled.current[f]) next[f] = '';
      autoFilled.current = {};
      const match = payees.find((p) => p.party.toLowerCase() === party.trim().toLowerCase());
      if (match) {
        const fill = {
          description: match.description,
          amount: match.amount === null ? '' : centsToInput(match.amount),
          categoryId: String(match.categoryId),
        };
        for (const f of fields) {
          if (!next[f]) {
            next[f] = fill[f];
            autoFilled.current[f] = fill[f];
          }
        }
      }
    }
    // someone who owes you is probably paying you back: link their oldest open debt
    if (type === 'income' && resetOnSave) {
      if (autoFilled.current.offsetCategoryId !== undefined && next.offsetCategoryId === autoFilled.current.offsetCategoryId) next.offsetCategoryId = '';
      delete autoFilled.current.offsetCategoryId;
      const debt = openDebts.find((d) => d.person.toLowerCase() === party.trim().toLowerCase());
      if (debt && !next.offsetCategoryId) {
        next.offsetCategoryId = `debt:${debt.id}`;
        autoFilled.current.offsetCategoryId = next.offsetCategoryId;
        if (!next.amount || next.amount === autoFilled.current.amount) {
          next.amount = centsToInput(debt.remaining);
          autoFilled.current.amount = next.amount;
        }
      }
    }
    setDraft(next);
  }

  const set = (field: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [field]: e.target.value }));

  async function save() {
    const amount = parseAmount(draft.amount);
    if (!draft.date) return setError('Pick a date.');
    if (amount === null) return setError('Enter a valid amount, e.g. 12,50.');
    if (!draft.categoryId) return setError('Pick a category.');
    setSaving(true);
    try {
      await onSave({
        month,
        date: draft.date,
        party: draft.party,
        description: draft.description,
        amount,
        categoryId: Number(draft.categoryId),
        offsetCategoryId: type === 'income' && draft.offsetCategoryId && !draft.offsetCategoryId.startsWith('debt:') ? Number(draft.offsetCategoryId) : null,
        debtId: type === 'income' && draft.offsetCategoryId.startsWith('debt:') ? Number(draft.offsetCategoryId.slice(5)) : null,
      });
      setError(null);
      if (resetOnSave) {
        // keep the date so entering several items from the same day is quick
        autoFilled.current = {};
        setDraft({ ...initial, date: draft.date });
        firstInput.current?.focus();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape' && onCancel) {
      onCancel();
    }
  }

  return (
    <>
      <tr className={resetOnSave ? 'new-row' : 'edit-row'} onKeyDown={onKeyDown}>
        <td className="col-date">
          <input ref={dateInput} type="date" value={draft.date} onChange={set('date')} aria-label="Date" />
        </td>
        <td>
          <input ref={firstInput} value={draft.party} onChange={(e) => changeParty(e.target.value)} list={`payees-${type}`} placeholder="Who" aria-label="Who" autoFocus={!resetOnSave} autoComplete="off" />
        </td>
        <td>
          <input value={draft.description} onChange={set('description')} placeholder="Description" aria-label="Description" />
        </td>
        <td className="num">
          <input ref={amountInput} className="num" inputMode="decimal" value={draft.amount} onChange={set('amount')} placeholder="0,00" aria-label="Amount" />
        </td>
        <td>
          <select value={draft.categoryId} onChange={set('categoryId')} aria-label="Category">
            <option value="" disabled>Category…</option>
            {categories.filter((c) => c.type === type).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {type === 'income' && (
            <select
              className="pays-back-select"
              value={draft.offsetCategoryId}
              onChange={set('offsetCategoryId')}
              aria-label="Pays back"
              title="If this pays you back for something (a friend's share), pick what: it then reduces that expense instead of counting as income"
            >
              <option value="">Doesn't pay anything back</option>
              {(openDebts.length > 0 || draft.offsetCategoryId.startsWith('debt:')) && (
                <optgroup label="Money owed to you">
                  {debts
                    .filter((d) => openDebts.includes(d) || draft.offsetCategoryId === `debt:${d.id}`)
                    .map((d) => (
                      <option key={d.id} value={`debt:${d.id}`}>
                        ↩ {debtLabel(d)} ({d.remaining ? `${formatMoney(d.remaining)} left` : 'paid back'})
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label="Expense category">
                {categories.filter((c) => c.type === 'expense').map((c) => (
                  <option key={c.id} value={c.id}>↩ Pays back {c.name}</option>
                ))}
              </optgroup>
            </select>
          )}
        </td>
        <td className="col-actions">
          <button className="btn primary small" onClick={save} disabled={saving}>{submitLabel}</button>
          {onCancel && <button className="icon-btn small" title="Cancel" onClick={onCancel}>↶</button>}
        </td>
      </tr>
      {error && (
        <tr className="row-error">
          <td colSpan={6}>{error}</td>
        </tr>
      )}
    </>
  );
}
