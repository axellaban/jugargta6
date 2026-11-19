'use client';
import { useEffect, useState } from 'react';

/** Re-render periódico con la hora del servidor (para countdowns). */
export function useNow(serverNow: () => number, intervalMs = 250, enabled = true): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!enabled) return;
    setNow(serverNow());
    const id = window.setInterval(() => setNow(serverNow()), intervalMs);
    return () => window.clearInterval(id);
  }, [serverNow, intervalMs, enabled]);
  return now;
}
