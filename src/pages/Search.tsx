import { useEffect, useState } from 'react';
import { api, type Category, type SearchResult, type TxType } from '../api';
import { formatDate, formatMoney, monthLabel } from '../format';

interface Props {
  categories: Category[];
}

export function Search({ categories }: Props) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<TxType | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [year, setYear] = useState('');
  const [years, setYears] = useState<number[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.years().then(setYears, () => {});
  }, []);

  const hasQuery = q.trim() !== '' || type !== '' || categoryId !== '' || year !== '';

  useEffect(() => {
    if (!hasQuery) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search({ q: q.trim(), type: type || undefined, categoryId: categoryId ? Number(categoryId) : undefined, year: year ? Number(year) : undefined })
        .then((r) => !cancelled && (setResult(r), setError(null)), (e: Error) => !cancelled && setError(e.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, type, categoryId, year, hasQuery]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="search-page">
      <div className="page-header">
        <h1>Search</h1>
      </div>
      <section className="card search-filters">
        <input
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search who or description, e.g. Ikea"
          aria-label="Search"
          autoFocus
        />
        <select value={type} onChange={(e) => setType(e.target.value as TxType | '')} aria-label="Type">
          <option value="">In and out</option>
          <option value="expense">Outgoing</option>
          <option value="income">Incoming</option>
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(['expense', 'income'] as const).map((t) => (
            <optgroup key={t} label={t === 'expense' ? 'Expense' : 'Income'}>
              {categories.filter((c) => c.type === t).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
          <option value="">All years</option>
          {[...years].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {!hasQuery ? (
        <p className="muted">Type something or pick a filter to search all your entries.</p>
      ) : result && (
        <section className="card">
          <header className="chart-header">
            <h2>{result.count === 1 ? '1 entry' : `${result.count} entries`}</h2>
            <span className="muted-text">
              {result.expense > 0 && <>Out {formatMoney(result.expense)}</>}
              {result.expense > 0 && result.income > 0 && ' · '}
              {result.income > 0 && <>In {formatMoney(result.income)}</>}
              {result.limited && ` · showing the newest ${result.rows.length}`}
            </span>
          </header>
          {result.rows.length > 0 && (
            <div className="table-scroll">
              <table className="tx-table search-table">
                <thead>
                  <tr>
                    <th className="col-date">Date</th>
                    <th>Budget month</th>
                    <th>Who</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((t) => (
                    <tr key={t.id}>
                      <td className="col-date">{formatDate(t.date)}</td>
                      <td><a href={`#/month/${t.month}`}>{monthLabel(t.month)}</a></td>
                      <td>{t.party}</td>
                      <td className="muted-text">{t.description}</td>
                      <td>
                        <span className="chip">{categoryName.get(t.categoryId) ?? '?'}</span>
                        {t.offsetCategoryId && <span className="pays-back">↩ {categoryName.get(t.offsetCategoryId) ?? '?'}</span>}
                      </td>
                      <td className={`num ${t.type === 'income' ? 'positive' : ''}`}>
                        {t.type === 'income' ? '+' : '−'}{formatMoney(t.amount)}
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
