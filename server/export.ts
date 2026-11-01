import ExcelJS from 'exceljs';
import { db } from './db';
import { monthlyTotals } from './reports';

interface ExportRow {
  month: string;
  date: string;
  type: 'income' | 'expense';
  party: string;
  description: string;
  amount: number;
  category: string;
  paysBack: string | null;
}

const allRows = () =>
  db.prepare(`
    SELECT t.month, t.date, t.type, t.party, t.description, t.amount, c.name AS category, o.name AS paysBack
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    LEFT JOIN categories o ON o.id = t.offset_category_id
    ORDER BY t.month, t.date, t.id
  `).all() as unknown as ExportRow[];

const csvCell = (value: string | number) => {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** All entries as CSV (UTF-8 with BOM so Excel shows € and accents correctly). */
export function exportCsv(): string {
  const header = ['Budget month', 'Date', 'Type', 'Who', 'Description', 'Amount', 'Category', 'Pays back'];
  const lines = allRows().map((r) =>
    [r.month, r.date, r.type, r.party, r.description, (r.amount / 100).toFixed(2), r.category, r.paysBack ?? ''].map(csvCell).join(','),
  );
  return '﻿' + [header.join(','), ...lines].join('\r\n');
}

/** Workbook with every entry plus a category × month totals sheet. */
export async function exportXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const euro = '€#,##0.00;[Red]-€#,##0.00';

  const entries = wb.addWorksheet('Entries', { views: [{ state: 'frozen', ySplit: 1 }] });
  entries.columns = [
    { header: 'Budget month', key: 'month', width: 13 },
    { header: 'Date', key: 'date', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Type', key: 'type', width: 9 },
    { header: 'Who', key: 'party', width: 24 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Amount', key: 'amount', width: 12, style: { numFmt: euro } },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Pays back', key: 'paysBack', width: 18 },
  ];
  for (const r of allRows()) {
    const [y, m, d] = r.date.split('-').map(Number);
    entries.addRow({ ...r, date: new Date(Date.UTC(y, m - 1, d)), amount: r.amount / 100, paysBack: r.paysBack ?? '' });
  }
  entries.getRow(1).font = { bold: true };
  entries.autoFilter = { from: 'A1', to: 'H1' };

  const categories = db.prepare('SELECT id, name, type FROM categories ORDER BY type DESC, name COLLATE NOCASE').all() as {
    id: number; name: string; type: string;
  }[];
  const totals = monthlyTotals();
  const months = [...new Set(totals.map((t) => t.month))].sort();
  const byKey = new Map(totals.map((t) => [`${t.categoryId}|${t.month}`, t.total]));

  const sheet = wb.addWorksheet('Totals', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  sheet.columns = [
    { header: 'Category', key: 'name', width: 24 },
    { header: 'Type', key: 'type', width: 9 },
    ...months.map((m) => ({ header: m, key: m, width: 12, style: { numFmt: euro } })),
  ];
  for (const c of categories) {
    const row: Record<string, string | number | null> = { name: c.name, type: c.type };
    for (const m of months) row[m] = (byKey.get(`${c.id}|${m}`) ?? 0) / 100;
    sheet.addRow(row);
  }
  sheet.getRow(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
