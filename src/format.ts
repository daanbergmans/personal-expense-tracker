const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const percent = new Intl.NumberFormat('en-IE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const formatMoney = (cents: number) => euro.format(cents / 100);

export const formatPercent = (part: number, whole: number) => (whole ? percent.format(part / whole) : '–');

/** YYYY-MM-DD -> DD/MM/YYYY */
export const formatDate = (iso: string) => iso.split('-').reverse().join('/');

/** Accepts "12.50", "12,50", "1.234,56" or "1,234.56"; returns cents or null. */
export function parseAmount(input: string): number | null {
  let s = input.replace(/[€\s]/g, '');
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (lastSep !== -1 && s.length - lastSep - 1 <= 2) {
    // last separator is the decimal one; strip the others as thousands separators
    s = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1);
  } else {
    s = s.replace(/[.,]/g, '');
  }
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return cents > 0 ? cents : null;
}

/** Cents -> "12.50" for editing. */
export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d.getFullYear(), d.getMonth() + 1);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${monthKey(d.getFullYear(), d.getMonth() + 1)}-${String(d.getDate()).padStart(2, '0')}`;
}
