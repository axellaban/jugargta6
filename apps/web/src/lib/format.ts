export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function compact(n: number): string {
  return new Intl.NumberFormat('es-AR', { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}

export function approxMinutes(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `~${h} h ${r} min` : `~${h} h`;
}
