import { useState } from 'react';
import { formatMoney, formatPercent } from '../format';

export interface Segment {
  label: string;
  value: number; // cents
}

const MAX_SLICES = 5; // more slices fold into "Other" so the donut stays readable

const SIZE = 180;
const OUTER = 88;
const INNER = 58;

function point(r: number, angle: number) {
  return [SIZE / 2 + r * Math.sin(angle), SIZE / 2 - r * Math.cos(angle)];
}

function arcPath(start: number, end: number) {
  const sweep = Math.min(end - start, Math.PI * 2 - 1e-4);
  const stop = start + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const [x0, y0] = point(OUTER, start);
  const [x1, y1] = point(OUTER, stop);
  const [x2, y2] = point(INNER, stop);
  const [x3, y3] = point(INNER, start);
  return `M${x0} ${y0} A${OUTER} ${OUTER} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${INNER} ${INNER} 0 ${large} 0 ${x3} ${y3}Z`;
}

/** Folds the smallest segments into "Other". Input does not need to be sorted. */
function slices(segments: Segment[]) {
  const sorted = segments.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_SLICES + 1) return sorted.map((s, i) => ({ ...s, color: `var(--series-${i + 1})` }));
  const head = sorted.slice(0, MAX_SLICES).map((s, i) => ({ ...s, color: `var(--series-${i + 1})` }));
  const rest = sorted.slice(MAX_SLICES);
  return [...head, { label: `Other (${rest.length})`, value: rest.reduce((sum, s) => sum + s.value, 0), color: 'var(--series-other)' }];
}

export function Donut({ segments, emptyText }: { segments: Segment[]; emptyText: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const items = slices(segments);
  const total = items.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) return <p className="muted donut-empty">{emptyText}</p>;

  let angle = 0;
  const arcs = items.map((s) => {
    const start = angle;
    angle += (s.value / total) * Math.PI * 2;
    return { ...s, d: arcPath(start, angle) };
  });
  const focus = hovered === null ? null : items[hovered];

  return (
    <div className="donut">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Breakdown by category">
        {arcs.map((a, i) => (
          <path
            key={a.label}
            d={a.d}
            fill={a.color}
            className={`donut-slice ${hovered !== null && hovered !== i ? 'dimmed' : ''}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>{`${a.label}: ${formatMoney(a.value)} (${formatPercent(a.value, total)})`}</title>
          </path>
        ))}
        <text x={SIZE / 2} y={SIZE / 2 - 6} className="donut-center-label">{focus ? focus.label : 'Total'}</text>
        <text x={SIZE / 2} y={SIZE / 2 + 14} className="donut-center-value">{formatMoney(focus ? focus.value : total)}</text>
      </svg>
      <ul className="legend">
        {items.map((s, i) => (
          <li
            key={s.label}
            className={hovered === i ? 'active' : ''}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="swatch" style={{ background: s.color }} />
            <span className="legend-label">{s.label}</span>
            <span className="legend-value">{formatPercent(s.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
