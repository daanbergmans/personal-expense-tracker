import { useEffect, useMemo, useState } from 'react';
import { api, type Category, type SummaryRow, type TotalRow, type TxType } from '../api';
import { Donut } from '../components/Donut';
import { MONTH_NAMES, formatMoney, formatPercent, monthKey } from '../format';
import { averagesBefore, relativeTo } from '../insights';

interface Props {
  year: number;
  categories: Category[];
}

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
const emptyYear = () => Array<number>(12).fill(0);

export function Overview({ year, categories }: Props) {
  const [summary, setSummary] = useState<SummaryRow[] | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statsMonth, setStatsMonth] = useState<number | null>(null);
  const [allTotals, setAllTotals] = useState<TotalRow[]>([]);

  useEffect(() => {
    api.years().then(setYears, () => {});
    api.totals().then(setAllTotals, () => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setStatsMonth(null);
    api.summary(year).then(
      (rows) => !cancelled && setSummary(rows),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [year]);

  // categoryId -> totals per month (index 0 = January)
  const byCategory = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const row of summary ?? []) {
      if (!map.has(row.categoryId)) map.set(row.categoryId, emptyYear());
      map.get(row.categoryId)![row.month - 1] = row.total;
    }
    return map;
  }, [summary]);

  const totalsFor = (type: TxType) => {
    const totals = emptyYear();
    for (const c of categories.filter((c) => c.type === type)) {
      byCategory.get(c.id)?.forEach((v, i) => (totals[i] += v));
    }
    return totals;
  };
  const incomeTotals = totalsFor('income');
  const expenseTotals = totalsFor('expense');

  // Default stats month: the current month for this year, otherwise the latest month with data.
  const now = new Date();
  const lastWithData = Math.max(0, ...incomeTotals.map((v, i) => (v || expenseTotals[i] ? i + 1 : 0)));
  const selected = statsMonth ?? (year === now.getFullYear() ? now.getMonth() + 1 : lastWithData || 1);

  const yearOptions = [...new Set([...years, year])].sort();
  const { averages, months: averageMonths } = averagesBefore(allTotals, monthKey(year, selected));

  return (
    <div className="overview">
      <div className="page-header">
        <div className="pager">
          <a className="icon-btn" href={`#/overview/${year - 1}`} aria-label="Previous year">‹</a>
          <h1>Income &amp; Expenses {year}</h1>
          <a className="icon-btn" href={`#/overview/${year + 1}`} aria-label="Next year">›</a>
        </div>
        {yearOptions.length > 1 && (
          <select value={year} onChange={(e) => (location.hash = `#/overview/${e.target.value}`)} aria-label="Year">
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {summary === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="overview-grid">
          <div className="overview-tables">
            {(['income', 'expense'] as const).map((type) => (
              <YearTable
                key={type}
                type={type}
                year={year}
                selected={selected}
                categories={categories.filter((c) => c.type === type)}
                byCategory={byCategory}
                totals={type === 'income' ? incomeTotals : expenseTotals}
              />
            ))}
            <BalanceTable year={year} selected={selected} categories={categories} byCategory={byCategory} />
          </div>

          <aside className="stats">
            <div className="stats-header">
              <h2>Stats for</h2>
              <select value={selected} onChange={(e) => setStatsMonth(Number(e.target.value))} aria-label="Stats month">
                {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
              </select>
            </div>
            {(['income', 'expense'] as const).map((type) => (
              <StatsCard
                key={type}
                type={type}
                categories={categories.filter((c) => c.type === type)}
                values={(id) => byCategory.get(id)?.[selected - 1] ?? 0}
                monthIncome={incomeTotals[selected - 1]}
                averages={averages}
              />
            ))}
            {averageMonths.length > 0 && (
              <p className="muted-text small">"vs avg" compares with the {averageMonths.length} months before, as on the month page.</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

interface YearTableProps {
  type: TxType;
  year: number;
  selected: number;
  categories: Category[];
  byCategory: Map<number, number[]>;
  totals: number[];
}

function Money({ cents }: { cents: number }) {
  return cents === 0 ? <span className="zero">–</span> : <>{formatMoney(cents)}</>;
}

function MonthHeaders({ year, selected }: { year: number; selected: number }) {
  return (
    <>
      {MONTH_NAMES.map((name, i) => (
        <th key={name} className={`num ${i + 1 === selected ? 'selected' : ''}`}>
          <a href={`#/month/${monthKey(year, i + 1)}`} title={`Open ${name} ${year}`}>{name.slice(0, 3)}</a>
        </th>
      ))}
    </>
  );
}

function YearTable({ type, year, selected, categories, byCategory, totals }: YearTableProps) {
  return (
    <section className={`card year-table-card ${type}`}>
      <div className="table-scroll">
        <table className="year-table">
          <thead>
            <tr>
              <th className="col-name">{type === 'income' ? 'Income' : 'Expenses'}</th>
              <MonthHeaders year={year} selected={selected} />
              <th className="num col-total">Total</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => {
              const values = byCategory.get(c.id) ?? emptyYear();
              return (
                <tr key={c.id}>
                  <td className="col-name">
                    {c.name}
                    {c.isSaving && <span className="saving-tag" title="Counts as saving, not spending">saving</span>}
                  </td>
                  {values.map((v, i) => (
                    <td key={i} className={`num ${i + 1 === selected ? 'selected' : ''}`}><Money cents={v} /></td>
                  ))}
                  <td className="num col-total"><Money cents={sum(values)} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-name">Total</td>
              {totals.map((v, i) => (
                <td key={i} className={`num ${i + 1 === selected ? 'selected' : ''}`}><Money cents={v} /></td>
              ))}
              <td className="num col-total"><Money cents={sum(totals)} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

interface BalanceProps {
  year: number;
  selected: number;
  categories: Category[];
  byCategory: Map<number, number[]>;
}

/** Per month: income, what was spent, what was saved or invested, and what's left. */
function BalanceTable({ year, selected, categories, byCategory }: BalanceProps) {
  const sumOf = (filter: (c: Category) => boolean) => {
    const totals = emptyYear();
    for (const c of categories.filter(filter)) byCategory.get(c.id)?.forEach((v, i) => (totals[i] += v));
    return totals;
  };
  const income = sumOf((c) => c.type === 'income');
  const spent = sumOf((c) => c.type === 'expense' && !c.isSaving);
  const saved = sumOf((c) => c.type === 'expense' && c.isSaving);
  const left = income.map((v, i) => v - spent[i] - saved[i]);
  const cell = (i: number, extra = '') => `num ${extra} ${i + 1 === selected ? 'selected' : ''}`;

  const moneyRow = (label: string, values: number[], title: string, signed = false) => (
    <tr title={title}>
      <td className="col-name">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={cell(i, signed && v < 0 ? 'negative' : '')}><Money cents={v} /></td>
      ))}
      <td className={`num col-total ${signed && sum(values) < 0 ? 'negative' : ''}`}><Money cents={sum(values)} /></td>
    </tr>
  );

  return (
    <section className="card year-table-card balance">
      <div className="table-scroll">
        <table className="year-table">
          <thead>
            <tr>
              <th className="col-name">Balance</th>
              <MonthHeaders year={year} selected={selected} />
              <th className="num col-total">Total</th>
            </tr>
          </thead>
          <tbody>
            {moneyRow('Income', income, 'Income, not counting repayments')}
            {moneyRow('Spent', spent, 'Expenses after repayments, without saving and investing')}
            {moneyRow('Saved & invested', saved, 'Expense categories that count as saving (see Categories)')}
            {moneyRow('Left', left, 'Income minus spent, saved and invested', true)}
            <tr title="Share of income not spent: saved, invested or left over">
              <td className="col-name">Not spent</td>
              {income.map((v, i) => (
                <td key={i} className={cell(i, 'muted-text')}>{v ? formatPercent(v - spent[i], v) : <span className="zero">–</span>}</td>
              ))}
              <td className="num col-total muted-text">{formatPercent(sum(income) - sum(spent), sum(income))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface StatsCardProps {
  type: TxType;
  categories: Category[];
  values: (categoryId: number) => number;
  monthIncome: number;
  /** Average per category over the months before, for the "vs avg" column. */
  averages: Map<number, number>;
}

function StatsCard({ type, categories, values, monthIncome, averages }: StatsCardProps) {
  const rows = categories
    .map((c) => ({ id: c.id, label: c.name, value: values(c.id), isSaving: c.isSaving }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = sum(rows.map((r) => r.value));
  const isExpense = type === 'expense';

  return (
    <section className={`card stats-card ${type}`}>
      <h3>{isExpense ? 'Expenses' : 'Income'}</h3>
      <Donut segments={rows} emptyText={`No ${isExpense ? 'expenses' : 'income'} this month.`} />
      {rows.length > 0 && (
        <table className="stats-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Sum</th>
              <th className="num">% of income</th>
              <th className="num" title="Compared with the average of the months before">vs avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = relativeTo(r.value, averages.get(r.id));
              // for spending, above average is bad; for income and saving, above average is good
              const goodWhenHigher = !isExpense || r.isSaving;
              const tone = diff === null || Math.abs(diff) < 0.1 ? 'muted-text' : (diff > 0) === goodWhenHigher ? 'positive' : 'negative';
              return (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td className="num">{formatMoney(r.value)}</td>
                  <td className="num">{formatPercent(r.value, monthIncome)}</td>
                  <td className={`num ${tone}`} title={averages.get(r.id) ? `Average ${formatMoney(averages.get(r.id)!)}` : undefined}>
                    {diff === null ? '–' : `${diff > 0 ? '+' : ''}${Math.round(diff * 100)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{formatMoney(total)}</td>
              <td className="num">{formatPercent(total, monthIncome)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
