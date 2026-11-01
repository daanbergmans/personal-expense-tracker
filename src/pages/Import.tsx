import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { api, type Category, type ImportRow } from '../api';
import {
  detectDateFormat, detectMonthSheet, extractColumns, extractMonthSheet, guessMapping, inferMonth, readCsv,
  type Candidate, type ColumnMapping, type DateFormat, type MonthSheetLayout,
} from '../import';
import { formatDate, formatMoney, monthLabel } from '../format';

interface Props {
  categories: Category[];
  onChange: () => void;
}

interface LoadedFile {
  name: string;
  rows: string[][];
  sheet: MonthSheetLayout | null;
  month: string; // budget month for month sheets
}

interface Choice {
  include?: boolean;
  category?: string; // "id:<n>" or "new:<name>"
}

const dupKey = (month: string, date: string, amount: number, party: string) => `${month}|${date}|${amount}|${party.toLowerCase()}`;

export function ImportPage({ categories, onChange }: Props) {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [dateFormat, setDateFormat] = useState<DateFormat>('dmy');
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; createdCategories: number; months: string[] } | null>(null);

  async function loadFiles(e: ChangeEvent<HTMLInputElement>) {
    const list = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!list.length) return;
    try {
      const loaded = await Promise.all(list.map(async (f) => {
        const rows = readCsv(await f.text());
        return { name: f.name, rows, sheet: detectMonthSheet(rows), month: '' };
      }));

      const columnFile = loaded.find((f) => !f.sheet);
      const guessed = columnFile ? guessMapping(columnFile.rows[0] ?? []) : null;
      const samples = loaded.flatMap((f) =>
        f.sheet
          ? f.rows.slice(f.sheet.headerRow + 1).flatMap((r) => [r[f.sheet!.incomeCol] ?? '', r[f.sheet!.expenseCol] ?? ''])
          : guessed && guessed.date >= 0 ? f.rows.slice(1).map((r) => r[guessed.date] ?? '') : [],
      );
      const fmt = detectDateFormat(samples);
      for (const f of loaded) {
        if (f.sheet) f.month = inferMonth(f.name, extractMonthSheet(f.rows, f.sheet, fmt).flatMap((c) => c.date ?? []));
      }

      setFiles(loaded);
      setDateFormat(fmt);
      setMapping(guessed);
      setChoices({});
      setResult(null);
      setError(null);
    } catch (err) {
      setError(`Could not read file: ${(err as Error).message}`);
    }
  }

  const groups = useMemo(
    () =>
      files.map((file, fi) => {
        const candidates: Candidate[] = file.sheet
          ? extractMonthSheet(file.rows, file.sheet, dateFormat)
          : mapping ? extractColumns(file.rows, mapping, dateFormat) : [];
        return {
          file,
          fi,
          rows: candidates.map((c) => ({
            ...c,
            key: `${fi}/${c.key}`,
            month: file.sheet ? file.month : (c.date?.slice(0, 7) ?? ''),
          })),
        };
      }),
    [files, mapping, dateFormat],
  );

  // Load existing entries of the affected months to flag duplicates.
  const months = [...new Set(groups.flatMap((g) => g.rows.map((r) => r.month)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
  const monthsKey = months.join(',');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!monthsKey) return setExisting(new Set());
    let cancelled = false;
    Promise.all(monthsKey.split(',').map((m) => api.transactions(m))).then(
      (lists) => !cancelled && setExisting(new Set(lists.flat().map((t) => dupKey(t.month, t.date, t.amount, t.party)))),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [monthsKey, refresh]);

  const categoryId = new Map(categories.map((c) => [`${c.type}|${c.name.toLowerCase()}`, c.id]));

  const resolved = groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => {
      const matched = categoryId.get(`${r.type}|${r.categoryName.toLowerCase()}`);
      const category = choices[r.key]?.category ?? (matched ? `id:${matched}` : r.categoryName ? `new:${r.categoryName}` : '');
      const duplicate = !!(r.date && r.amount !== null && existing.has(dupKey(r.month, r.date, r.amount, r.party)));
      const problem = r.error ?? (!/^\d{4}-\d{2}$/.test(r.month) ? 'Set a budget month' : !category ? 'Pick a category' : undefined);
      const include = !problem && (choices[r.key]?.include ?? !duplicate);
      return { ...r, category, duplicate, problem, include };
    }),
  }));
  const allRows = resolved.flatMap((g) => g.rows);
  const selected = allRows.filter((r) => r.include);
  const newCategories = new Set(selected.filter((r) => r.category.startsWith('new:')).map((r) => `${r.type}|${r.category.slice(4).toLowerCase()}`));

  const choose = (key: string, choice: Choice) => setChoices((c) => ({ ...c, [key]: { ...c[key], ...choice } }));
  const setFileMonth = (fi: number, month: string) => setFiles((fs) => fs.map((f, i) => (i === fi ? { ...f, month } : f)));

  async function runImport() {
    const rows: ImportRow[] = selected.map((r) => ({
      month: r.month,
      date: r.date!,
      type: r.type,
      party: r.party,
      description: r.description,
      amount: r.amount!,
      ...(r.category.startsWith('id:') ? { categoryId: Number(r.category.slice(3)) } : { categoryName: r.category.slice(4) }),
    }));
    setBusy(true);
    setError(null);
    try {
      const res = await api.importTransactions(rows);
      setResult({ ...res, months: [...new Set(rows.map((r) => r.month))].sort() });
      setFiles([]);
      setChoices({});
      setRefresh((n) => n + 1);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const header = files.find((f) => !f.sheet)?.rows[0] ?? [];
  const columnOptions = header.map((h, i) => ({ value: i, label: mapping?.hasHeader && h ? h : `Column ${i + 1}` }));

  return (
    <div className="import-page">
      <h2 className="section-title">Import CSV</h2>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}

      {result && (
        <div className="card notice">
          Imported {result.imported} {result.imported === 1 ? 'entry' : 'entries'}
          {result.createdCategories > 0 && ` and created ${result.createdCategories} new ${result.createdCategories === 1 ? 'category' : 'categories'}`}
          {' into '}
          {result.months.map((m, i) => (
            <span key={m}>{i > 0 && ', '}<a href={`#/month/${m}`}>{monthLabel(m)}</a></span>
          ))}
          .
        </div>
      )}

      <section className="card import-intro">
        <p>
          In Google Sheets, open a month sheet and use <strong>File → Download → Comma-separated values (.csv)</strong>.
          That exports the current sheet only, so repeat it per month. You can select several files at once.
        </p>
        <p className="muted-text">
          Only works for month sheets with an <em>Incoming</em> and an <em>Outgoing</em> block, each with the columns date,
          who, description, amount and category. Other formats, such as bank exports, are not supported.
        </p>
        <div className="import-controls">
          <label className="btn primary file-btn">
            Choose CSV files…
            <input type="file" accept=".csv,text/csv" multiple onChange={loadFiles} hidden />
          </label>
          {files.length > 0 && (
            <label className="field">
              Date format
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                <option value="dmy">DD/MM/YYYY</option>
                <option value="mdy">MM/DD/YYYY</option>
                <option value="ymd">YYYY-MM-DD</option>
              </select>
            </label>
          )}
        </div>
      </section>

      {mapping && files.some((f) => !f.sheet) && (
        <section className="card mapping">
          <h2>Columns</h2>
          <div className="mapping-grid">
            {(['date', 'party', 'description', 'amount', 'category'] as const).map((field) => (
              <label key={field} className="field">
                {{ date: 'Date', party: 'Who', description: 'Description', amount: 'Amount', category: 'Category' }[field]}
                <select value={mapping[field]} onChange={(e) => setMapping({ ...mapping, [field]: Number(e.target.value) })}>
                  <option value={-1}>—</option>
                  {columnOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
            <label className="field">
              Entries are
              <select value={mapping.typeMode} onChange={(e) => setMapping({ ...mapping, typeMode: e.target.value as ColumnMapping['typeMode'] })}>
                <option value="sign">Negative = outgoing</option>
                <option value="expense">All outgoing</option>
                <option value="income">All incoming</option>
              </select>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => setMapping({ ...mapping, hasHeader: e.target.checked })} />
              First row is a header
            </label>
          </div>
          <p className="muted-text small">Entries count towards the month of their date.</p>
        </section>
      )}

      {resolved.map(({ file, fi, rows }) => {
        const includable = rows.filter((r) => !r.problem);
        const allOn = includable.length > 0 && includable.every((r) => r.include);
        return (
          <section key={fi} className="card import-file">
            <header className="import-file-header">
              <h2>{file.name}</h2>
              <span className="chip">{file.sheet ? 'Month sheet' : 'Columns'}</span>
              {file.sheet && (
                <label className="field inline">
                  Budget month
                  <input type="month" value={file.month} onChange={(e) => setFileMonth(fi, e.target.value)} />
                </label>
              )}
              <span className="muted-text">{rows.filter((r) => r.include).length} of {rows.length} selected</span>
            </header>
            {rows.length === 0 ? (
              <p className="muted empty">No entries found{file.sheet ? '' : ' — check the column mapping'}.</p>
            ) : (
              <div className="table-scroll">
                <table className="tx-table import-table">
                  <thead>
                    <tr>
                      <th className="col-check">
                        <input
                          type="checkbox"
                          checked={allOn}
                          aria-label="Select all"
                          onChange={() => setChoices((c) => {
                            const next = { ...c };
                            for (const r of includable) next[r.key] = { ...next[r.key], include: !allOn };
                            return next;
                          })}
                        />
                      </th>
                      <th>Type</th>
                      <th className="col-date">Date</th>
                      <th>Who</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                      <th className="col-category">Category</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className={r.include ? '' : 'excluded'}>
                        <td className="col-check">
                          <input
                            type="checkbox"
                            checked={r.include}
                            disabled={!!r.problem}
                            aria-label="Include"
                            onChange={(e) => choose(r.key, { include: e.target.checked })}
                          />
                        </td>
                        <td><span className={`type-badge ${r.type}`}>{r.type === 'income' ? 'In' : 'Out'}</span></td>
                        <td className="col-date">{r.date ? formatDate(r.date) : '—'}</td>
                        <td>{r.party}</td>
                        <td className="muted-text">{r.description}</td>
                        <td className="num">{r.amount !== null ? formatMoney(r.amount) : '—'}</td>
                        <td>
                          <select value={r.category} onChange={(e) => choose(r.key, { category: e.target.value })} aria-label="Category">
                            <option value="" disabled>Category…</option>
                            {categories.filter((c) => c.type === r.type).map((c) => (
                              <option key={c.id} value={`id:${c.id}`}>{c.name}</option>
                            ))}
                            {r.categoryName && !categoryId.has(`${r.type}|${r.categoryName.toLowerCase()}`) && (
                              <option value={`new:${r.categoryName}`}>＋ New: {r.categoryName}</option>
                            )}
                          </select>
                        </td>
                        <td className="status">
                          {r.problem ? (
                            <span className="negative">{r.problem}</span>
                          ) : r.duplicate ? (
                            <span className="muted-text" title="An entry with the same month, date, amount and who already exists">Already imported</span>
                          ) : r.category.startsWith('new:') ? (
                            <span className="muted-text">New category</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {files.length > 0 && (
        <div className="import-bar">
          <span>
            <strong>{selected.length}</strong> of {allRows.length} entries selected
            {newCategories.size > 0 && ` · ${newCategories.size} new ${newCategories.size === 1 ? 'category' : 'categories'}`}
            {allRows.some((r) => r.duplicate) && ` · ${allRows.filter((r) => r.duplicate).length} already imported`}
            {allRows.some((r) => r.problem) && <span className="negative"> · {allRows.filter((r) => r.problem).length} need attention</span>}
          </span>
          <span className="import-bar-actions">
            <button className="btn" onClick={() => setFiles([])} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={runImport} disabled={busy || selected.length === 0}>
              {busy ? 'Importing…' : `Import ${selected.length} ${selected.length === 1 ? 'entry' : 'entries'}`}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
