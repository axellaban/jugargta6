'use client';

import { useState } from 'react';

// Color de marca para datos, validado para la superficie oscura (L 0.48–0.67, ≥3:1).
const MARK = '#f03a85';
const MARK_HOVER = '#ff6aa6';
const GRID = 'var(--color-border)';

export interface DailyPoint {
  day: string;
  [k: string]: number | string;
}

const fmt = (n: number) => new Intl.NumberFormat('es-AR', { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n);
const dayLabel = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Columnas de una sola serie (small multiple). Sin leyenda: el título nombra la serie. */
export function MiniColumns({ title, data, field }: { title: string; data: DailyPoint[]; field: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 120;
  const pad = { l: 28, r: 4, t: 8, b: 18 };
  const values = data.map((d) => Number(d[field]) || 0);
  const max = niceMax(Math.max(0, ...values));
  const total = values.reduce((a, b) => a + b, 0);
  const band = (W - pad.l - pad.r) / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(2, band - 2));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const base = y(0);
  const h = hover != null ? data[hover] : null;

  return (
    <figure className="rounded-xl border border-border bg-panel-2 p-3">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-muted">{title}</span>
        <span className="tabular text-sm font-bold">{h ? `${fmt(Number(h[field]) || 0)} · ${dayLabel(String(h.day))}` : fmt(total)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)} role="img" aria-label={`${title} por día`}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--color-faint)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const v = values[i];
          const x = pad.l + i * band + (band - barW) / 2;
          const top = y(v);
          const hgt = Math.max(0, base - top);
          const r = Math.min(4, hgt, barW / 2);
          // 4px redondeado en el extremo del dato, cuadrado en la base
          const path =
            hgt <= 0
              ? ''
              : `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`;
          return (
            <g key={String(d.day)} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${dayLabel(String(d.day))}: ${v}`}>
              <rect x={pad.l + i * band} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" />
              {path && <path d={path} fill={hover === i ? MARK_HOVER : MARK} />}
            </g>
          );
        })}
        {data.length > 0 && (
          <>
            <text x={pad.l} y={H - 4} fontSize={9} fill="var(--color-faint)">
              {dayLabel(String(data[0].day))}
            </text>
            <text x={W - pad.r} y={H - 4} fontSize={9} textAnchor="end" fill="var(--color-faint)">
              {dayLabel(String(data[data.length - 1].day))}
            </text>
          </>
        )}
      </svg>
    </figure>
  );
}

/** Embudo como lista de medidores: nombre, barra y cifra por fila, todas contra la primera etapa. */
export function FunnelMeters({ steps }: { steps: Array<{ label: string; value: number }> }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ul className="space-y-2.5">
      {steps.map((s, i) => {
        const pct = (s.value / top) * 100;
        const prev = i > 0 ? steps[i - 1].value : null;
        const conv = prev ? (s.value / Math.max(1, prev)) * 100 : null;
        return (
          <li key={s.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[180px_minmax(0,1fr)_120px]">
            <span className="truncate text-sm">{s.label}</span>
            <span className="tabular text-right text-sm font-bold sm:order-last">
              {fmt(s.value)} {conv != null && <span className="text-xs font-normal text-muted">({conv.toFixed(conv < 10 ? 1 : 0)}%)</span>}
            </span>
            <span className="col-span-2 h-2.5 rounded-full bg-panel-3 sm:col-span-1" title={`${pct.toFixed(1)}% del total`}>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(pct, s.value > 0 ? 1.5 : 0)}%`, background: MARK }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
