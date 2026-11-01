import { useEffect, useState } from 'react';
import { monthFromIndex, monthIndex } from '../../shared/patterns';
import { api, type Category, type TotalRow } from '../api';
import { BarChart, type Bar } from '../components/BarChart';
import { MONTH_NAMES, formatMoney, monthLabel } from '../format';

interface Props {
  categories: Category[];
}

type SeriesKey = 'spent' | 'saved' | 'income' | 'left' | `cat:${number}`;
type Range = '12' | '24' | 'all';

const SUMMARY_SERIES: { key: SeriesKey; label: string }[] = [
  { key: 'spent', label: 'Spent' },
  { key: 'saved', label: 'Saved & invested' },
  { key: 'income', label: 'Income' },
  { key: 'left', label: 'Left' },
];

/** Value of a series in one month, from that month's net totals per category. */
function seriesValue(key: SeriesKey, totals: Map<number, number>, categories: Category[]): number {
  if (key.startsWith('cat:')) return totals.get(Number(key.slice(4))) ?? 0;
  let income = 0;
  let spent = 0;
  let saved = 0;
  for (const c of categories) {
    const v = totals.get(c.id) ?? 0;
    if (c.type === 'income') income += v;
    else if (c.isSaving) saved += v;
    else spent += v;
  }
  return { spent, saved, income, left: income - spent - saved }[key as 'spent' | 'saved' | 'income' | 'left'];
}

export function Trends({ categories }: Props) {
  const [totals, setTotals] = useState<TotalRow[] | null>(null);
  const [series, setSeries] = useState<SeriesKey>('spent');
  const [range, setRange] = useState<Range>('24');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.totals().then(setTotals, (e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!totals) return <p className="muted">Loading…</p>;
  if (totals.length === 0) return <p className="muted">No entries yet. Trends appear once you have a few months of data.</p>;

  // every budget month from the first with data to the last, without gaps
  const byMonth = new Map<string, Map<number, number>>();
  for (const r of totals) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, new Map());
    byMonth.get(r.month)!.set(r.categoryId, r.total);
  }
  const first = monthIndex(totals[0].month);
  const last = monthIndex(totals[totals.length - 1].month);
  const allMonths = Array.from({ length: last - first + 1 }, (_, i) => monthFromIndex(first + i));
  const months = range === 'all' ? allMonths : allMonths.slice(-Number(range));

  const valueOf = (key: SeriesKey, month: string) => seriesValue(key, byMonth.get(month) ?? new Map(), categories);
  const bars: Bar[] = months.map((m) => {
    const [y, mm] = m.split('-').map(Number);
    return { key: m, label: mm === 1 ? String(y) : MONTH_NAMES[mm - 1].slice(0, 3), title: monthLabel(m), value: valueOf(series, m) };
  });
  // months without any entries (gaps in the history) would drag the average down, so skip them
  const counted = bars.filter((b) => byMonth.has(b.key));
  const average = Math.round(counted.reduce((s, b) => s + b.value, 0) / Math.max(1, counted.length));
  const seriesLabel = series.startsWith('cat:')
    ? categories.find((c) => c.id === Number(series.slice(4)))?.name ?? '?'
    : SUMMARY_SERIES.find((s) => s.key === series)!.label;

  // year-over-year: average per month with data in each year, so a partial year compares fairly
  const years = [...new Set(allMonths.map((m) => Number(m.slice(0, 4))))];
  const monthsInYear = (year: number) => allMonths.filter((m) => m.startsWith(`${year}-`) && byMonth.has(m));
  const yearAverage = (key: SeriesKey, year: number) => {
    const ms = monthsInYear(year);
    return ms.length ? Math.round(ms.reduce((s, m) => s + valueOf(key, m), 0) / ms.length) : null;
  };
  const yoyRows: { key: SeriesKey; label: string; summary?: boolean }[] = [
    ...SUMMARY_SERIES.map((s) => ({ ...s, summary: true })),
    ...categories
      .filter((c) => c.type === 'expense' && totals.some((t) => t.categoryId === c.id))
      .map((c) => ({ key: `cat:${c.id}` as SeriesKey, label: c.name })),
    ...categories
      .filter((c) => c.type === 'income' && totals.some((t) => t.categoryId === c.id))
      .map((c) => ({ key: `cat:${c.id}` as SeriesKey, label: `${c.name} (income)` })),
  ];
  const [prevYear, lastYear] = years.slice(-2);

  return (
    <div className="trends-page">
      <div className="page-header">
        <h1>Trends</h1>
        <div className="trend-controls">
          <select value={series} onChange={(e) => setSeries(e.target.value as SeriesKey)} aria-label="What to show">
            <optgroup label="Totals">
              {SUMMARY_SERIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </optgroup>
            <optgroup label="Expense categories">
              {categories.filter((c) => c.type === 'expense').map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}
            </optgroup>
            <optgroup label="Income categories">
              {categories.filter((c) => c.type === 'income').map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}
            </optgroup>
          </select>
          <div className="segmented" role="group" aria-label="Period">
            {(['12', '24', 'all'] as const).map((r) => (
              <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                {r === 'all' ? 'All' : `${r} months`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="card chart-card">
        <header className="chart-header">
          <h2>{seriesLabel} per month</h2>
          <span className="muted-text">
            Average {formatMoney(average)} over {counted.length} months with entries. Click a bar to open that month.
          </span>
        </header>
        <BarChart
          bars={bars}
          reference={{ value: average, label: `avg ${formatMoney(average)}` }}
          onSelect={(b) => (location.hash = `#/month/${b.key}`)}
        />
      </section>

      <section className="card yoy">
        <header className="chart-header">
          <h2>Year against year</h2>
          <span className="muted-text">Average per month in each year (only months with entries count). Click a row to chart it.</span>
        </header>
        <div className="table-scroll">
          <table className="yoy-table">
            <thead>
              <tr>
                <th />
                {years.map((y) => (
                  <th key={y} className="num">
                    {y} <span className="muted-text">({monthsInYear(y).length} mo)</span>
                  </th>
                ))}
                {prevYear && <th className="num" title={`${lastYear} compared with ${prevYear}`}>Change</th>}
              </tr>
            </thead>
            <tbody>
              {yoyRows.map((row) => {
                const values = years.map((y) => yearAverage(row.key, y));
                const a = prevYear ? yearAverage(row.key, prevYear) : null;
                const b = lastYear ? yearAverage(row.key, lastYear) : null;
                const change = a && b !== null && a > 0 ? (b - a) / a : null;
                const goodWhenHigher = row.key === 'income' || row.key === 'saved' || row.key === 'left' ||
                  categories.find((c) => `cat:${c.id}` === row.key)?.type === 'income' ||
                  !!categories.find((c) => `cat:${c.id}` === row.key)?.isSaving;
                const tone = change === null || Math.abs(change) < 0.05 ? 'muted-text' : (change > 0) === goodWhenHigher ? 'positive' : 'negative';
                return (
                  <tr key={row.key} className={`${row.summary ? 'summary-row' : ''} ${series === row.key ? 'active' : ''}`} onClick={() => setSeries(row.key)}>
                    <td>{row.label}</td>
                    {values.map((v, i) => (
                      <td key={years[i]} className="num">{v === null ? <span className="zero">–</span> : formatMoney(v)}</td>
                    ))}
                    {prevYear && (
                      <td className={`num ${tone}`}>{change === null ? '–' : `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
