import { useState } from 'react';
import type { Category } from '../api';
import { formatMoney, monthLabel } from '../format';
import { relativeTo } from '../insights';

interface Props {
  categories: Category[];
  /** Net amount per category for the month being looked at. */
  values: Map<number, number>;
  /** Average per category over `averageMonths`. */
  averages: Map<number, number>;
  averageMonths: string[];
  title: string;
}

const COLLAPSED_ROWS = 10;
const NOTABLE = 0.1; // differences under 10% aren't highlighted

/** Expense categories for one month next to their recent average, biggest first. */
export function CategoryComparison({ categories, values, averages, averageMonths, title }: Props) {
  const [showAll, setShowAll] = useState(false);

  const rows = categories
    .filter((c) => c.type === 'expense')
    .map((c) => ({ category: c, value: values.get(c.id) ?? 0, average: averages.get(c.id) ?? 0 }))
    .filter((r) => r.value !== 0 || r.average !== 0)
    .sort((a, b) => b.value - a.value || b.average - a.average);
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.value, r.average)));
  const visible = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);

  const sum = (saving: boolean, pick: 'value' | 'average') =>
    rows.filter((r) => r.category.isSaving === saving).reduce((s, r) => s + r[pick], 0);
  const period = averageMonths.length
    ? `${monthLabel(averageMonths[averageMonths.length - 1])} – ${monthLabel(averageMonths[0])}`
    : '';

  return (
    <section className="card comparison">
      <header className="comparison-header">
        <h2>{title}</h2>
        {averageMonths.length > 0 ? (
          <span className="muted-text">
            Average of {averageMonths.length} {averageMonths.length === 1 ? 'month' : 'months'} ({period}).
            {' '}Spent {formatMoney(sum(false, 'value'))} vs {formatMoney(sum(false, 'average'))} on average
            {' · '}saved {formatMoney(sum(true, 'value'))} vs {formatMoney(sum(true, 'average'))}.
          </span>
        ) : (
          <span className="muted-text">No earlier months to compare with yet.</span>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="muted empty">No spending this month.</p>
      ) : (
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="col-bar" aria-label="Compared to average" />
              <th className="num">This month</th>
              <th className="num">Average</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ category, value, average }) => {
              const diff = relativeTo(value, average);
              // spending more than usual is bad, saving more than usual is good
              const worse = diff !== null && (category.isSaving ? diff < -NOTABLE : diff > NOTABLE);
              const better = diff !== null && (category.isSaving ? diff > NOTABLE : diff < -NOTABLE);
              return (
                <tr key={category.id}>
                  <td>
                    {category.name}
                    {category.isSaving && <span className="saving-tag">saving</span>}
                  </td>
                  <td className="col-bar">
                    <div className="bar-track" title={`${formatMoney(value)} this month, ${formatMoney(average)} on average`}>
                      <div className="bar-fill" style={{ width: `${(Math.max(0, value) / scale) * 100}%` }} />
                      {average > 0 && <div className="bar-average" style={{ left: `${(average / scale) * 100}%` }} />}
                    </div>
                  </td>
                  <td className="num">{formatMoney(value)}</td>
                  <td className="num muted-text">{average ? formatMoney(average) : '–'}</td>
                  <td className={`num ${worse ? 'negative' : better ? 'positive' : 'muted-text'}`}>
                    {diff === null ? (value > 0 ? 'new' : '–') : `${diff > 0 ? '+' : ''}${Math.round(diff * 100)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows.length > COLLAPSED_ROWS && (
        <button className="link-btn show-all" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${rows.length} categories`}
        </button>
      )}
    </section>
  );
}
