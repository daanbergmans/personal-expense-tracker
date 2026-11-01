import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { dataDir, db } from './db';

export const backupDir = path.join(dataDir, 'backups');
const KEEP_DAILY = 14;
const DAILY_RE = /^expenses-(\d{4}-\d{2}-\d{2})\.db$/;

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  automatic: boolean;
}

/** Writes a consistent copy of the database; safe while the app is in use. */
export function createBackup(automatic: boolean): BackupInfo {
  mkdirSync(backupDir, { recursive: true });
  const now = new Date();
  const name = automatic
    ? `expenses-${today()}.db`
    : `expenses-${today()}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-manual.db`;
  const file = path.join(backupDir, name);
  if (existsSync(file)) unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return info(name);
}

function info(name: string): BackupInfo {
  const stat = statSync(path.join(backupDir, name));
  return { name, size: stat.size, createdAt: stat.mtime.toISOString(), automatic: DAILY_RE.test(name) };
}

export function listBackups(): BackupInfo[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((n) => n.endsWith('.db'))
    .map(info)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Makes one automatic backup per day and keeps the most recent ones; manual backups are never removed. */
export function startDailyBackups() {
  const run = () => {
    try {
      if (!existsSync(path.join(backupDir, `expenses-${today()}.db`))) createBackup(true);
      const daily = readdirSync(backupDir).filter((n) => DAILY_RE.test(n)).sort().reverse();
      for (const old of daily.slice(KEEP_DAILY)) unlinkSync(path.join(backupDir, old));
    } catch (err) {
      console.error('Automatic backup failed:', err);
    }
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref(); // checks hourly, so a server left running still backs up daily
}
