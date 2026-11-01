import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../format';

export interface Bar {
  key: string;
  label: string; // short axis label
  title: string; // full label for the tooltip
  value: number; // cents
}

interface Props {
  bars: Bar[];
  /** Dashed reference line, e.g. the average of the bars. */
  reference?: { value: number; label: string };
  onSelect?: (bar: Bar) => void;
}

const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };

const compact = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 });

function niceStep(range: number) {
  const raw = range / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
}

/** One-series bar chart that sizes itself to its container, with a hover tooltip per bar. */
export function BarChart({ bars, reference, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  const values = bars.map((b) => b.value);
  const max = Math.max(0, ...values, reference?.value ?? 0);
  const min = Math.min(0, ...values);
  const step = niceStep(max - min);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom)) * plotH;
  const slot = plotW / Math.max(1, bars.length);
  const barW = Math.max(3, Math.min(32, slot * 0.7));
  const labelEvery = Math.ceil(44 / slot); // keep axis labels from colliding
  const ticks: number[] = [];
  for (let v = bottom; v <= top + 1e-6; v += step) ticks.push(v);

  const hovered = hover === null ? null : bars[hover];

  return (
    <div className="bar-chart" ref={box}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Bar chart per month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline' : 'chart-grid'} />
            <text x={PAD.left - 8} y={y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">{compact.format(t / 100)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const y0 = y(0);
          const y1 = y(b.value);
          const h = Math.abs(y1 - y0);
          const r = Math.min(4, barW / 2, h);
          const up = b.value >= 0;
          // rounded on the end away from the baseline
          const d = up
            ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0} Z`
            : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 - r} V${y0} Z`;
          return (
            <g key={b.key}>
              {h > 0 && <path d={d} className={`chart-bar ${up ? '' : 'negative'} ${hover !== null && hover !== i ? 'dimmed' : ''}`} />}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={HEIGHT - 8} className="chart-tick" textAnchor="middle">{b.label}</text>
              )}
              {/* hit area bigger than the bar */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(b)}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
              />
            </g>
          );
        })}
        {reference && (
          <g className="chart-reference">
            <line x1={PAD.left} x2={width - PAD.right} y1={y(reference.value)} y2={y(reference.value)} />
            <text x={width - PAD.right} y={y(reference.value) - 6} textAnchor="end">{reference.label}</text>
          </g>
        )}
      </svg>
      {hovered && hover !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(width - 170, Math.max(0, PAD.left + hover * slot + slot / 2 - 80)),
            top: Math.max(0, Math.min(y(hovered.value), y(0)) - 64),
          }}
        >
          <div className="chart-tooltip-title">{hovered.title}</div>
          <div className="chart-tooltip-value">{formatMoney(hovered.value)}</div>
          {reference && <div className="muted-text">{reference.label}</div>}
        </div>
      )}
    </div>
  );
}
