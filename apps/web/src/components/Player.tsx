'use client';

import { ExternalLink, Gamepad2, Radio, Timer, Wifi } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mmss } from '@/lib/format';
import { buildEmbed } from '@/lib/stream';
import { useNow } from '@/hooks/useNow';
import type { RealSession } from '@/hooks/useRealSession';
import { useLiveRoom } from './LiveRoom';
import { Badge } from './ui';

export function Player({
  realSession,
  overlay,
  mouseTargetRef,
}: {
  realSession: RealSession | null;
  overlay?: React.ReactNode;
  mouseTargetRef?: (el: HTMLElement | null) => void;
}) {
  const { settings, mode, snapshot, serverNow } = useLiveRoom();
  const [host, setHost] = useState('localhost');
  useEffect(() => setHost(window.location.hostname), []);
  const embed = useMemo(() => buildEmbed(settings.stream_provider, settings.stream_source, host), [settings.stream_provider, settings.stream_source, host]);
  const now = useNow(serverNow, 500);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = realSession?.stream ?? null;

  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  const cur = snapshot.current;
  const remaining = cur?.status === 'playing' && cur.ends_at ? Date.parse(cur.ends_at) - now : null;
  const showWebrtc = mode === 'REAL' && Boolean(stream);
  const latency = realSession?.videoRttMs ?? realSession?.inputRttMs ?? null;

  return (
    <div ref={mouseTargetRef} className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black">
      {showWebrtc ? (
        <video ref={videoRef} className="size-full object-contain" autoPlay playsInline muted={false} />
      ) : embed.src ? (
        <iframe
          key={embed.src}
          src={embed.src}
          title={settings.stream_title}
          className="size-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="grid size-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgb(255_61_139/0.25),transparent_50%),radial-gradient(circle_at_80%_80%,rgb(255_159_67/0.2),transparent_45%)]">
          <div className="text-center">
            <Gamepad2 className="mx-auto mb-3 size-12 text-accent" />
            <p className="font-semibold">La transmisión arranca en breve</p>
            <p className="mt-1 text-sm text-muted">El admin todavía no configuró el canal en /admin.</p>
          </div>
        </div>
      )}

      {/* Badges superiores: no tapan los controles del reproductor del proveedor */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-1.5 rounded-lg bg-black/60 p-1 backdrop-blur">
        {mode === 'REAL' ? (
          <>
            <Badge tone="live" className="animate-pulse-ring">
              <Radio className="size-3" /> en vivo · consola #1
            </Badge>
            {showWebrtc && latency != null && (
              <Badge tone="ok">
                <Wifi className="size-3" /> {latency} ms
              </Badge>
            )}
          </>
        ) : (
          <Badge tone="info">
            <Radio className="size-3" /> transmisión de referencia
          </Badge>
        )}
      </div>

      {embed.sourceUrl && !showWebrtc && (
        <a
          href={embed.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute right-3 top-3 hidden items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/80 backdrop-blur hover:text-white sm:flex"
        >
          Fuente: {embed.label} <ExternalLink className="size-3" />
        </a>
      )}

      {cur && !overlay && (
        <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-xl bg-black/70 px-2.5 py-1.5 text-xs backdrop-blur sm:bottom-3 sm:left-3 sm:px-3 sm:py-2 sm:text-sm">
          <Gamepad2 className="size-4 text-accent" />
          <span className="text-muted">{mode === 'REAL' ? 'Al mando:' : 'En práctica:'}</span>
          <span className="max-w-[140px] truncate font-semibold">{cur.display_name}</span>
          {remaining != null && (
            <span className="tabular flex items-center gap-1 text-muted">
              <Timer className="size-3.5" /> {mmss(remaining)}
            </span>
          )}
          {cur.status === 'offered' && <span className="text-vip">confirmando…</span>}
        </div>
      )}

      {overlay}
    </div>
  );
}
