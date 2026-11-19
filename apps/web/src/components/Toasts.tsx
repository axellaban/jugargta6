'use client';

import { CircleCheck, Info, TriangleExclamationPoint } from 'lucide-react';
import { createContext, useCallback, useContext, useState } from 'react';

type Tone = 'info' | 'error' | 'ok';
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

const Ctx = createContext<(text: string, tone?: Tone) => void>(() => undefined);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
              t.tone === 'error' ? 'border-live/40 bg-live/15 text-red-100' : t.tone === 'ok' ? 'border-ok/40 bg-ok/15 text-green-100' : 'border-border bg-panel-2/95'
            }`}
          >
            {t.tone === 'error' ? <TriangleExclamationPoint className="size-4 shrink-0" /> : t.tone === 'ok' ? <CircleCheck className="size-4 shrink-0" /> : <Info className="size-4 shrink-0" />}
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
