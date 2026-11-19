'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'brand' | 'solid' | 'ghost' | 'outline' | 'danger' | 'vip';

const VARIANTS: Record<Variant, string> = {
  brand: 'bg-brand text-white shadow-lg shadow-accent/20 hover:brightness-110',
  solid: 'bg-panel-3 text-text hover:bg-border',
  ghost: 'text-muted hover:text-text hover:bg-panel-3',
  outline: 'border border-border text-text hover:border-accent/60 hover:bg-panel-2',
  danger: 'bg-live/90 text-white hover:bg-live',
  vip: 'bg-vip text-black hover:brightness-110 shadow-lg shadow-vip/20',
};

export function Button({
  variant = 'solid',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-base' };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition [&_svg]:shrink-0 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${sizes[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: string;
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissable && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissable]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={`max-h-[92dvh] w-full ${width} overflow-y-auto rounded-t-2xl border border-border bg-panel shadow-2xl outline-none sm:rounded-2xl scrollbar-thin`}
      >
        {(title || dismissable) && (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-panel/95 px-5 py-4 backdrop-blur">
            <h2 className="text-base font-bold">{title}</h2>
            {dismissable && (
              <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-panel-3 hover:text-text" aria-label="Cerrar">
                <X className="size-5" />
              </button>
            )}
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'muted', className = '' }: { children: ReactNode; tone?: 'muted' | 'live' | 'vip' | 'founder' | 'info' | 'ok' | 'accent'; className?: string }) {
  const tones = {
    muted: 'bg-panel-3 text-muted',
    live: 'bg-live text-white',
    vip: 'bg-vip/15 text-vip ring-1 ring-vip/30',
    founder: 'bg-accent/15 text-accent ring-1 ring-accent/30',
    info: 'bg-info/15 text-info ring-1 ring-info/30',
    ok: 'bg-ok/15 text-ok ring-1 ring-ok/30',
    accent: 'bg-brand text-white',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Avatar({ name, url, size = 28 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />;
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
      style={{ width: size, height: size, background: `hsl(${hue} 60% 38%)` }}
    >
      {initials || '?'}
    </span>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-panel ${className}`}>{children}</section>;
}
