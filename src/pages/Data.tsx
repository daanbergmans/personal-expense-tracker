import { useEffect, useState } from 'react';
import { api, type BackupInfo, type Category } from '../api';
import { ImportPage } from './Import';

interface Props {
  categories: Category[];
  onChange: () => void;
}

const BACKUPS_SHOWN = 8;

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Export, backups and CSV import in one place. */
export function DataPage({ categories, onChange }: Props) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.backups().then(setBackups, (e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function backUpNow() {
    setBusy(true);
    try {
      const b = await api.createBackup();
      setMessage(`Saved ${b.name}`);
      setError(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="data-page">
      <div className="page-header">
        <h1>Data</h1>
      </div>
      {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}

      <div className="data-cards">
        <section className="card data-card">
          <h2>Export</h2>
          <p className="muted-text">
            Download all your entries. The Excel file also has a sheet with totals per category per month.
          </p>
          <div className="data-actions">
            <a className="btn primary" href="/api/export.xlsx" download>Download Excel (.xlsx)</a>
            <a className="btn" href="/api/export.csv" download>Download CSV</a>
          </div>
        </section>

        <section className="card data-card">
          <h2>Backups</h2>
          <p className="muted-text">
            A copy of your data is saved automatically once a day (the last 14 are kept) in <code>data/backups</code>.
            To restore one, stop the app and replace <code>data/expenses.db</code> with the backup file.
          </p>
          <div className="data-actions">
            <button className="btn primary" onClick={backUpNow} disabled={busy}>{busy ? 'Backing up…' : 'Back up now'}</button>
            {message && <span className="positive small-text">{message}</span>}
          </div>
          {backups && backups.length > 0 && (
            <ul className="backup-list">
              {backups.slice(0, BACKUPS_SHOWN).map((b) => (
                <li key={b.name}>
                  <span>{formatWhen(b.createdAt)}</span>
                  <span className="muted-text">{b.automatic ? 'daily' : 'manual'}</span>
                  <span className="muted-text num">{formatSize(b.size)}</span>
                </li>
              ))}
              {backups.length > BACKUPS_SHOWN && <li className="muted-text">and {backups.length - BACKUPS_SHOWN} older</li>}
            </ul>
          )}
        </section>
      </div>

      <ImportPage categories={categories} onChange={onChange} />
    </div>
  );
}
