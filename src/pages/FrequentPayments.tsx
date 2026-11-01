import { useEffect, useState, type KeyboardEvent } from 'react';
import { api, type Category, type PaymentHistory, type PaymentKind, type QuickPayment, type QuickPaymentInput, type TxType } from '../api';
import { centsToInput, formatDate, formatMoney, parseAmount } from '../format';

interface Props {
  categories: Category[];
}

const ordinal = (n: number) => {
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
};

const describeSchedule = (day: number | null, monthOffset: number) =>
  `${day === null ? 'Varying day' : ordinal(day)} of ${monthOffset === -1 ? 'the month before' : 'the month'}`;

const sortPayments = (a: QuickPayment, b: QuickPayment) =>
  (a.type === b.type ? 0 : a.type === 'income' ? -1 : 1) ||
  a.monthOffset - b.monthOffset ||
  (a.day ?? 0) - (b.day ?? 0) ||
  (a.party || a.description).localeCompare(b.party || b.description);

/** Price changes the user chose to ignore, remembered per payment and amount in this browser. */
const IGNORED_KEY = 'ignoredPriceChanges';
function readIgnored(): string[] {
  try {
    return JSON.parse(localStorage.getItem(IGNORED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function FrequentPayments({ categories }: Props) {
  const [payments, setPayments] = useState<QuickPayment[] | null>(null);
  const [history, setHistory] = useState<PaymentHistory[]>([]);
  const [ignored, setIgnored] = useState<string[]>(readIgnored);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    api.quickPayments().then((list) => setPayments(list.sort(sortPayments)), (e: Error) => setError(e.message));
    api.paymentHistory().then(setHistory, (e: Error) => setError(e.message));
  };
  useEffect(reload, []);

  function ignore(key: string) {
    const next = [...ignored, key];
    setIgnored(next);
    try {
      localStorage.setItem(IGNORED_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: the notice comes back next visit
    }
  }

  const historyById = new Map(history.map((h) => [h.id, h]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  // saved amount differs from what was actually paid last time
  const priceChanges = (payments ?? []).flatMap((p) => {
    const h = historyById.get(p.id);
    if (p.amount === null || !h?.lastAmount || h.lastAmount === p.amount) return [];
    const key = `${p.id}:${h.lastAmount}`;
    return ignored.includes(key) ? [] : [{ payment: p, lastAmount: h.lastAmount, lastDate: h.lastDate!, key }];
  });

  // what the monthly payments add up to; varying amounts use the average of the last three times
  let fixedIncome = 0;
  let fixedSpending = 0;
  let fixedSaving = 0;
  let estimated = false;
  for (const p of (payments ?? []).filter((p) => p.kind === 'monthly')) {
    const amount = p.amount ?? historyById.get(p.id)?.recentAverage ?? 0;
    if (p.amount === null) estimated = true;
    const target = p.type === 'income' ? (p.offsetCategoryId ? categoryById.get(p.offsetCategoryId) : undefined) : categoryById.get(p.categoryId);
    const sign = p.type === 'income' && p.offsetCategoryId ? -1 : 1; // repayments reduce the cost they pay back
    if (p.type === 'income' && !p.offsetCategoryId) fixedIncome += amount;
    else if (target?.isSaving) fixedSaving += sign * amount;
    else fixedSpending += sign * amount;
  }
  const approx = estimated ? '≈ ' : '';

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }

  function remove(p: QuickPayment) {
    if (confirm(`Delete "${p.party || p.description}" from your frequent payments?`)) run(() => api.deleteQuickPayment(p.id)).catch(() => {});
  }

  return (
    <div className="payments-page">
      <div className="page-header">
        <div>
          <h1>Frequent payments</h1>
          <p className="muted-text page-intro">
            Saved payments appear in the Quick add panel on every month page. Monthly ones are proposed each month on the
            day below; frequent ones fill in the add row with one click.
          </p>
        </div>
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}

      {payments === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {payments.some((p) => p.kind === 'monthly') && (
            <div className="stat-tiles fixed-costs">
              <div className="stat-tile" title="Monthly payments to non-saving categories, minus regular repayments">
                <span className="stat-label">Fixed monthly costs</span>
                <span className="stat-value">{approx}{formatMoney(fixedSpending)}</span>
              </div>
              <div className="stat-tile" title="Monthly payments to categories that count as saving">
                <span className="stat-label">Saved &amp; invested monthly</span>
                <span className="stat-value">{approx}{formatMoney(fixedSaving)}</span>
              </div>
              <div className="stat-tile" title="Monthly income payments that aren't repayments">
                <span className="stat-label">Regular income</span>
                <span className="stat-value">{approx}{formatMoney(fixedIncome)}</span>
              </div>
              <div className="stat-tile" title="Regular income minus fixed costs and saving: what's left for everything else">
                <span className="stat-label">Left for the rest</span>
                <span className={`stat-value ${fixedIncome - fixedSpending - fixedSaving < 0 ? 'negative' : 'positive'}`}>
                  {approx}{formatMoney(fixedIncome - fixedSpending - fixedSaving)}
                </span>
              </div>
              {estimated && <p className="muted-text small fixed-note">≈ Varying amounts are estimated from the last three times they were paid.</p>}
            </div>
          )}

          {priceChanges.length > 0 && (
            <section className="card price-changes">
              <header className="payments-section-header">
                <h2>Amount changed</h2>
                <span className="muted-text">The last payment differs from the saved amount.</span>
              </header>
              <ul>
                {priceChanges.map(({ payment: p, lastAmount, lastDate, key }) => (
                  <li key={key}>
                    <span className="price-name">{p.party || p.description}</span>
                    <span className="muted-text">
                      saved {formatMoney(p.amount!)}, last paid <strong className="price-new">{formatMoney(lastAmount)}</strong> on {formatDate(lastDate)}
                      {lastAmount > p.amount! ? ` (+${formatMoney(lastAmount - p.amount!)})` : ` (−${formatMoney(p.amount! - lastAmount)})`}
                    </span>
                    <span className="price-actions">
                      <button className="btn primary small" onClick={() => run(() => api.updateQuickPayment(p.id, { amount: lastAmount })).catch(() => {})}>
                        Update to {formatMoney(lastAmount)}
                      </button>
                      <button className="btn small" title="Keep the saved amount and hide this notice" onClick={() => ignore(key)}>Ignore</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(['monthly', 'frequent'] as const).map((kind) => (
            <PaymentSection
              key={kind}
              kind={kind}
              payments={payments.filter((p) => p.kind === kind)}
              categories={categories}
              onCreate={(input) => run(() => api.createQuickPayment(input))}
              onUpdate={(id, input) => run(() => api.updateQuickPayment(id, input))}
              onDelete={remove}
            />
          ))}
        </>
      )}
    </div>
  );
}

interface SectionProps {
  kind: PaymentKind;
  payments: QuickPayment[];
  categories: Category[];
  onCreate: (input: QuickPaymentInput) => Promise<void>;
  onUpdate: (id: number, input: QuickPaymentInput) => Promise<void>;
  onDelete: (p: QuickPayment) => void;
}

function PaymentSection({ kind, payments, categories, onCreate, onUpdate, onDelete }: SectionProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const monthly = kind === 'monthly';
  const columns = monthly ? 7 : 6;

  return (
    <section className="card payments-section">
      <header className="payments-section-header">
        <h2>{monthly ? 'Monthly' : 'Frequent'}</h2>
        <span className="muted-text">
          {monthly ? 'Rent, salary, subscriptions: proposed once every month.' : 'Lunch, groceries, coffee: one click fills in the add row.'}
        </span>
      </header>
      <div className="table-scroll">
        <table className="tx-table payments-table">
          <thead>
            <tr>
              <th className="col-type">Type</th>
              <th>Who</th>
              <th>Description</th>
              <th className="col-category">Category</th>
              <th className="num col-amount">Amount</th>
              {monthly && <th className="col-schedule">Paid on</th>}
              <th className="col-actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr>
                <td colSpan={columns} className="empty">
                  No {kind} payments saved yet. Add one below.
                </td>
              </tr>
            )}
            {payments.map((p) =>
              p.id === editingId ? (
                <PaymentEditor
                  key={p.id}
                  kind={kind}
                  categories={categories}
                  initial={toDraft(p)}
                  submitLabel="Save"
                  onSave={async (input) => {
                    await onUpdate(p.id, input);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <tr key={p.id} onDoubleClick={() => setEditingId(p.id)}>
                  <td><span className={`type-badge ${p.type}`}>{p.type === 'income' ? 'In' : 'Out'}</span></td>
                  <td>{p.party}</td>
                  <td className="muted-text">{p.description}</td>
                  <td>
                    <span className="chip">{categoryName.get(p.categoryId) ?? '?'}</span>
                    {p.offsetCategoryId && <span className="pays-back">↩ {categoryName.get(p.offsetCategoryId) ?? '?'}</span>}
                  </td>
                  <td className="num">{p.amount === null ? <span className="varies">Varies</span> : formatMoney(p.amount)}</td>
                  {monthly && <td className="muted-text">{describeSchedule(p.day, p.monthOffset)}</td>}
                  <td className="col-actions">
                    <button className="icon-btn small" title="Edit" onClick={() => setEditingId(p.id)}>✎</button>
                    <button className="icon-btn small danger" title="Delete" onClick={() => onDelete(p)}>✕</button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
          <tfoot>
            <PaymentEditor
              kind={kind}
              categories={categories}
              initial={{
                type: 'expense', party: '', description: '', amount: '', amountVaries: false,
                categoryId: '', offsetCategoryId: '', day: '1', dayVaries: false, monthOffset: '0',
              }}
              submitLabel="Add"
              resetOnSave
              onSave={onCreate}
            />
          </tfoot>
        </table>
      </div>
    </section>
  );
}

interface Draft {
  type: TxType;
  party: string;
  description: string;
  amount: string;
  amountVaries: boolean;
  categoryId: string;
  /** Income only: expense category this pays back, '' for none. */
  offsetCategoryId: string;
  day: string;
  dayVaries: boolean;
  monthOffset: string;
}

const toDraft = (p: QuickPayment): Draft => ({
  type: p.type,
  party: p.party,
  description: p.description,
  amount: p.amount === null ? '' : centsToInput(p.amount),
  amountVaries: p.amount === null,
  categoryId: String(p.categoryId),
  offsetCategoryId: p.offsetCategoryId ? String(p.offsetCategoryId) : '',
  day: p.day === null ? '' : String(p.day),
  dayVaries: p.kind === 'monthly' && p.day === null,
  monthOffset: String(p.monthOffset),
});

interface EditorProps {
  kind: PaymentKind;
  categories: Category[];
  initial: Draft;
  submitLabel: string;
  resetOnSave?: boolean;
  onSave: (input: QuickPaymentInput) => Promise<void>;
  onCancel?: () => void;
}

function PaymentEditor({ kind, categories, initial, submitLabel, resetOnSave, onSave, onCancel }: EditorProps) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const monthly = kind === 'monthly';

  const set = (field: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [field]: e.target.value }));
  const toggle = (field: 'amountVaries' | 'dayVaries') => (e: { target: { checked: boolean } }) =>
    setDraft((d) => ({ ...d, [field]: e.target.checked }));

  async function save() {
    const amount = draft.amountVaries ? null : parseAmount(draft.amount);
    const day = draft.dayVaries ? null : Number(draft.day);
    if (!draft.party.trim() && !draft.description.trim()) return setError('Enter who or a description.');
    if (!draft.amountVaries && amount === null) return setError('Enter a valid amount, e.g. 12,50, or tick "varies".');
    if (!draft.categoryId) return setError('Pick a category.');
    if (monthly && day !== null && !(Number.isInteger(day) && day >= 1 && day <= 31)) {
      return setError('Day must be between 1 and 31, or tick "varies".');
    }
    setSaving(true);
    try {
      await onSave({
        kind,
        party: draft.party,
        description: draft.description,
        amount,
        categoryId: Number(draft.categoryId),
        day: monthly ? day : null,
        monthOffset: monthly ? Number(draft.monthOffset) : 0,
        offsetCategoryId: draft.type === 'income' && draft.offsetCategoryId ? Number(draft.offsetCategoryId) : null,
      });
      setError(null);
      if (resetOnSave) setDraft({ ...initial, type: draft.type });
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
        <td>
          <select
            value={draft.type}
            onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as TxType, categoryId: '', offsetCategoryId: '' }))}
            aria-label="Type"
          >
            <option value="expense">Out</option>
            <option value="income">In</option>
          </select>
        </td>
        <td><input value={draft.party} onChange={set('party')} placeholder="Who" aria-label="Who" autoFocus={!resetOnSave} /></td>
        <td><input value={draft.description} onChange={set('description')} placeholder="Description" aria-label="Description" /></td>
        <td>
          <select value={draft.categoryId} onChange={set('categoryId')} aria-label="Category">
            <option value="" disabled>Category…</option>
            {categories.filter((c) => c.type === draft.type).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {draft.type === 'income' && (
            <select
              className="pays-back-select"
              value={draft.offsetCategoryId}
              onChange={set('offsetCategoryId')}
              aria-label="Pays back"
              title="If this pays you back for something (e.g. a friend's share of Spotify), it reduces that expense instead of counting as income"
            >
              <option value="">Doesn't pay anything back</option>
              {categories.filter((c) => c.type === 'expense').map((c) => (
                <option key={c.id} value={c.id}>↩ Pays back {c.name}</option>
              ))}
            </select>
          )}
        </td>
        <td className="num">
          <span className="varies-field">
            <input
              className="num"
              inputMode="decimal"
              value={draft.amountVaries ? '' : draft.amount}
              onChange={set('amount')}
              placeholder={draft.amountVaries ? 'varies' : '0,00'}
              disabled={draft.amountVaries}
              aria-label="Amount"
            />
            <label className="varies-toggle" title="The amount is different each time; you type it when adding">
              <input type="checkbox" checked={draft.amountVaries} onChange={toggle('amountVaries')} />
              varies
            </label>
          </span>
        </td>
        {monthly && (
          <td>
            <span className="schedule-inputs">
              <input
                type="number"
                min={1}
                max={31}
                value={draft.dayVaries ? '' : draft.day}
                onChange={set('day')}
                placeholder={draft.dayVaries ? '–' : ''}
                disabled={draft.dayVaries}
                aria-label="Day of month"
              />
              <select value={draft.monthOffset} onChange={set('monthOffset')} aria-label="Which month">
                <option value="0">of the month</option>
                <option value="-1">of the month before</option>
              </select>
              <label className="varies-toggle" title="The day is different each month; you pick it when adding">
                <input type="checkbox" checked={draft.dayVaries} onChange={toggle('dayVaries')} />
                varies
              </label>
            </span>
          </td>
        )}
        <td className="col-actions">
          <button className="btn primary small" onClick={save} disabled={saving}>{submitLabel}</button>
          {onCancel && <button className="icon-btn small" title="Cancel" onClick={onCancel}>↶</button>}
        </td>
      </tr>
      {error && (
        <tr className="row-error">
          <td colSpan={monthly ? 7 : 6}>{error}</td>
        </tr>
      )}
    </>
  );
}
