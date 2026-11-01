import { useEffect, useState, type KeyboardEvent } from 'react';
import { api, type Category, type Debt, type DebtInput } from '../api';
import { centsToInput, formatDate, formatMoney, monthLabel, parseAmount, todayIso } from '../format';

interface Props {
  categories: Category[];
}

const daysSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86_400_000));
const age = (iso: string) => {
  const d = daysSince(iso);
  return d === 0 ? 'today' : d === 1 ? '1 day' : d < 60 ? `${d} days` : `${Math.round(d / 30)} months`;
};

export function Owed({ categories }: Props) {
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () => api.debts().then(setDebts, (e: Error) => setError(e.message));
  useEffect(() => {
    reload();
    api.payees().then((p) => setPeople([...new Set(p.map((x) => x.party))]), () => {});
  }, []);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }

  if (!debts) return error ? <div className="error-banner">{error}</div> : <p className="muted">Loading…</p>;

  const open = debts.filter((d) => d.status === 'open' || d.status === 'partial');
  const closed = debts.filter((d) => d.status === 'repaid' || d.status === 'settled').reverse();
  const byPerson = new Map<string, Debt[]>();
  for (const d of open) byPerson.set(d.person, [...(byPerson.get(d.person) ?? []), d]);
  const groups = [...byPerson.entries()]
    .map(([person, list]) => ({ person, list, total: list.reduce((s, d) => s + d.remaining, 0) }))
    .sort((a, b) => b.total - a.total);
  const outstanding = groups.reduce((s, g) => s + g.total, 0);
  const oldest = open[0]; // debts come sorted by date
  const personNames = [...new Set([...debts.map((d) => d.person), ...people])];

  return (
    <div className="owed-page">
      <div className="page-header">
        <div>
          <h1>Owed to me</h1>
          <p className="muted-text page-intro">
            Money people need to pay back. A repayment is added as an incoming entry that reduces the debt's
            category instead of counting as income, so what you paid for others doesn't inflate your spending.
          </p>
        </div>
        <div className="stat-tiles">
          <div className="stat-tile">
            <span className="stat-label">Still owed to you</span>
            <span className="stat-value">{formatMoney(outstanding)}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">People</span>
            <span className="stat-value">{groups.length}</span>
          </div>
          {oldest && (
            <div className="stat-tile">
              <span className="stat-label">Waiting longest</span>
              <span className="stat-value">{age(oldest.date)}</span>
              <span className="stat-sub">{oldest.person}{oldest.description && ` · ${oldest.description}`}</span>
            </div>
          )}
        </div>
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}

      <datalist id="debt-people">
        {personNames.map((p) => <option key={p} value={p} />)}
      </datalist>

      <section className="card owed-add">
        <h2>Someone owes you</h2>
        <table className="tx-table owed-table">
          <tbody>
            <DebtEditor
              categories={categories}
              initial={{ person: '', description: '', amount: '', date: todayIso(), categoryId: '' }}
              submitLabel="Add"
              resetOnSave
              onSave={(d) => run(() => api.createDebt(d))}
            />
          </tbody>
        </table>
        <p className="muted-text small">
          Tip: on a month page, use the 👥 button on an outgoing entry to say someone owes you (part of) it.
        </p>
      </section>

      {groups.length === 0 ? (
        <p className="muted">Nobody owes you anything right now.</p>
      ) : (
        groups.map((g) => (
          <PersonCard
            key={g.person}
            person={g.person}
            total={g.total}
            debts={g.list}
            categories={categories}
            run={run}
          />
        ))
      )}

      {closed.length > 0 && (
        <section className="card owed-closed">
          <header className="payments-section-header">
            <h2>Paid back &amp; settled</h2>
            <button className="link-btn" onClick={() => setShowClosed(!showClosed)}>
              {showClosed ? 'Hide' : `Show ${closed.length}`}
            </button>
          </header>
          {showClosed && (
            <div className="table-scroll">
              <table className="tx-table owed-table">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>What for</th>
                    <th className="num">Amount</th>
                    <th>Closed</th>
                    <th className="col-actions" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {closed.map((d) => (
                    <tr key={d.id}>
                      <td>{d.person}</td>
                      <td className="muted-text">{d.description}</td>
                      <td className="num">{formatMoney(d.amount)}</td>
                      <td className="muted-text">
                        {d.status === 'settled'
                          ? `Settled ${formatDate(d.settledAt!)}${d.settledNote ? ` · ${d.settledNote}` : ''}`
                          : `Paid back ${formatDate(d.repayments[d.repayments.length - 1]?.date ?? d.date)}`}
                      </td>
                      <td className="col-actions">
                        {d.status === 'settled' && (
                          <button className="icon-btn small" title="Reopen" onClick={() => run(() => api.updateDebt(d.id, { settled: false })).catch(() => {})}>↺</button>
                        )}
                        <button
                          className="icon-btn small danger"
                          title="Delete"
                          onClick={() => confirm(`Delete "${d.description || d.person}"? Repayments stay as normal entries.`) && run(() => api.deleteDebt(d.id)).catch(() => {})}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

interface PersonCardProps {
  person: string;
  total: number;
  debts: Debt[];
  categories: Category[];
  run: (action: () => Promise<unknown>) => Promise<void>;
}

function PersonCard({ person, total, debts, categories, run }: PersonCardProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [repayingId, setRepayingId] = useState<number | null>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  function settle(d: Debt) {
    const note = prompt(`Close "${d.description || 'this debt'}" without a repayment entry?\nOptional note, e.g. "paid in cash" or "forgiven":`, '');
    if (note !== null) run(() => api.updateDebt(d.id, { settled: true, settledNote: note })).catch(() => {});
  }

  return (
    <section className="card person-card">
      <header className="person-header">
        <h2>{person}</h2>
        <span className="person-total">{formatMoney(total)}</span>
        <span className="muted-text">{debts.length === 1 ? '1 open item' : `${debts.length} open items`}</span>
      </header>
      <div className="table-scroll">
        <table className="tx-table owed-table">
          <thead>
            <tr>
              <th className="col-date">Since</th>
              <th>What for</th>
              <th className="col-category">Category</th>
              <th className="num">Amount</th>
              <th className="num">Paid back</th>
              <th className="num">Still owed</th>
              <th className="col-owed-actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {debts.map((d) =>
              d.id === editingId ? (
                <DebtEditor
                  key={d.id}
                  categories={categories}
                  initial={{
                    person: d.person,
                    description: d.description,
                    amount: centsToInput(d.amount),
                    date: d.date,
                    categoryId: d.categoryId ? String(d.categoryId) : '',
                  }}
                  submitLabel="Save"
                  onSave={async (input) => {
                    await run(() => api.updateDebt(d.id, input));
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <DebtRows
                  key={d.id}
                  debt={d}
                  categoryName={d.categoryId ? categoryName.get(d.categoryId) : undefined}
                  repaying={repayingId === d.id}
                  categories={categories}
                  onRepay={() => setRepayingId(repayingId === d.id ? null : d.id)}
                  onRepaid={async (r) => {
                    await run(() => api.repayDebt(d.id, r));
                    setRepayingId(null);
                  }}
                  onSettle={() => settle(d)}
                  onEdit={() => setEditingId(d.id)}
                  onDelete={() =>
                    confirm(`Delete "${d.description || d.person}"? Repayments stay as normal entries.`) &&
                    run(() => api.deleteDebt(d.id)).catch(() => {})
                  }
                />
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface DebtRowsProps {
  debt: Debt;
  categoryName?: string;
  repaying: boolean;
  categories: Category[];
  onRepay: () => void;
  onRepaid: (r: { amount: number; date: string; month: string; categoryId?: number }) => Promise<void>;
  onSettle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function DebtRows({ debt: d, categoryName, repaying, categories, onRepay, onRepaid, onSettle, onEdit, onDelete }: DebtRowsProps) {
  return (
    <>
      <tr>
        <td className="col-date">
          {formatDate(d.date)}
          <div className="muted-text small-text">{age(d.date)}</div>
        </td>
        <td>
          {d.description || <span className="muted-text">—</span>}
          {d.expenseMonth && (
            <div className="small-text"><a href={`#/month/${d.expenseMonth}`}>from {monthLabel(d.expenseMonth)}</a></div>
          )}
          {d.repayments.map((r) => (
            <div key={r.id} className="muted-text small-text">
              Paid back {formatMoney(r.amount)} on {formatDate(r.date)} · <a href={`#/month/${r.month}`}>{monthLabel(r.month)}</a>
            </div>
          ))}
        </td>
        <td>{categoryName ? <span className="chip">{categoryName}</span> : <span className="muted-text">—</span>}</td>
        <td className="num">{formatMoney(d.amount)}</td>
        <td className="num muted-text">{d.repaid ? formatMoney(d.repaid) : '–'}</td>
        <td className="num owed-remaining">{formatMoney(d.remaining)}</td>
        <td className="col-owed-actions">
          <button className="btn primary small" onClick={onRepay}>{repaying ? 'Cancel' : 'Paid back…'}</button>
          <button className="icon-btn small" title="Close without a repayment entry (paid in cash, forgiven…)" onClick={onSettle}>✓</button>
          <button className="icon-btn small" title="Edit" onClick={onEdit}>✎</button>
          <button className="icon-btn small danger" title="Delete" onClick={onDelete}>✕</button>
        </td>
      </tr>
      {repaying && <RepaymentRow debt={d} categories={categories} onSave={onRepaid} />}
    </>
  );
}

function RepaymentRow({ debt, categories, onSave }: { debt: Debt; categories: Category[]; onSave: DebtRowsProps['onRepaid'] }) {
  const incomeCategories = categories.filter((c) => c.type === 'income');
  const [amount, setAmount] = useState(centsToInput(debt.remaining));
  const [date, setDate] = useState(todayIso());
  const [month, setMonth] = useState('');
  const [categoryId, setCategoryId] = useState(String((incomeCategories.find((c) => c.name === 'Repayment') ?? incomeCategories[0])?.id ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // suggest the budget month the date belongs to (your months run payday to payday)
  useEffect(() => {
    if (!date) return;
    api.budgetMonth(date).then((r) => setMonth(r.month), () => setMonth(date.slice(0, 7)));
  }, [date]);

  async function save() {
    const cents = parseAmount(amount);
    if (cents === null) return setError('Enter a valid amount, e.g. 12,50.');
    if (!date || !month) return setError('Pick a date and budget month.');
    setSaving(true);
    try {
      await onSave({ amount: cents, date, month, categoryId: categoryId ? Number(categoryId) : undefined });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  };

  return (
    <tr className="edit-row repayment-row" onKeyDown={onKeyDown}>
      <td colSpan={7}>
        <div className="repayment-form">
          <label className="field">
            Amount
            <input className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </label>
          <label className="field">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            Budget month
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label className="field">
            Income category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {incomeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button className="btn primary" onClick={save} disabled={saving}>Save repayment</button>
          <span className="muted-text small-text">
            Added as an incoming entry from {debt.person}{month && ` in ${monthLabel(month)}`}.
          </span>
        </div>
        {error && <p className="row-error">{error}</p>}
      </td>
    </tr>
  );
}

interface Draft {
  person: string;
  description: string;
  amount: string;
  date: string;
  categoryId: string;
}

interface EditorProps {
  categories: Category[];
  initial: Draft;
  submitLabel: string;
  resetOnSave?: boolean;
  onSave: (input: DebtInput) => Promise<void>;
  onCancel?: () => void;
}

function DebtEditor({ categories, initial, submitLabel, resetOnSave, onSave, onCancel }: EditorProps) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (field: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [field]: e.target.value }));

  async function save() {
    const amount = parseAmount(draft.amount);
    if (!draft.person.trim()) return setError('Who owes you?');
    if (amount === null) return setError('Enter a valid amount, e.g. 12,50.');
    if (!draft.date) return setError('Pick a date.');
    setSaving(true);
    try {
      await onSave({
        person: draft.person,
        description: draft.description,
        amount,
        date: draft.date,
        categoryId: draft.categoryId ? Number(draft.categoryId) : null,
      });
      setError(null);
      if (resetOnSave) setDraft({ ...initial, date: draft.date });
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
        <td className="col-date"><input type="date" value={draft.date} onChange={set('date')} aria-label="Since" /></td>
        <td>
          <div className="debt-who-what">
            <input value={draft.person} onChange={set('person')} list="debt-people" placeholder="Who" aria-label="Who" autoComplete="off" />
            <input value={draft.description} onChange={set('description')} placeholder="What for, e.g. dinner at Rauw" aria-label="What for" autoFocus={!resetOnSave} />
          </div>
        </td>
        <td className="col-category">
          <select value={draft.categoryId} onChange={set('categoryId')} aria-label="Category" title="Expense category a repayment reduces">
            <option value="">No category</option>
            {categories.filter((c) => c.type === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </td>
        <td className="num"><input className="num" inputMode="decimal" value={draft.amount} onChange={set('amount')} placeholder="0,00" aria-label="Amount" /></td>
        {!resetOnSave && <><td /><td /></>}
        <td className="col-owed-actions">
          <button className="btn primary small" onClick={save} disabled={saving}>{submitLabel}</button>
          {onCancel && <button className="icon-btn small" title="Cancel" onClick={onCancel}>↶</button>}
        </td>
      </tr>
      {error && (
        <tr className="row-error">
          <td colSpan={7}>{error}</td>
        </tr>
      )}
    </>
  );
}
