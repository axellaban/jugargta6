'use client';

import { FrameType, decodeFrame, encodePing, encodeState, statesEqual, type GamepadState } from '@jugargta/protocol';
import { useEffect, useRef, useState } from 'react';

interface Credentials {
  turn: number;
  endsAt: string;
  bridgeUrl: string;
  bridgeToken: string;
  bridgeTokenExp: number;
  whepUrl: string;
  streamToken: string;
  iceServers: RTCIceServer[];
  profile: 'ps5' | 'xbox';
}

export type LinkStatus = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'error' | 'kicked';

export interface RealSession {
  bridge: LinkStatus;
  video: LinkStatus;
  stream: MediaStream | null;
  /** RTT navegador ↔ bridge (ping/pong del protocolo). */
  inputRttMs: number | null;
  /** RTT del par ICE de WebRTC. */
  videoRttMs: number | null;
  blocked: string[];
  error: string | null;
}

async function fetchCredentials(): Promise<Credentials> {
  const res = await fetch('/api/session/credentials', { method: 'POST' });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as Credentials;
}

/** WHEP mínimo (RFC 9725): offer → POST SDP → answer. */
async function startWhep(url: string, token: string, iceServers: RTCIceServer[], onTrack: (s: MediaStream) => void) {
  const pc = new RTCPeerConnection({ iceServers });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => onTrack(e.streams[0] ?? new MediaStream([e.track]));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // Esperamos candidatos ICE (máx. 1,5 s) para mandar un SDP completo.
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = window.setTimeout(resolve, 1500);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        window.clearTimeout(t);
        resolve();
      }
    });
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${token}` },
    body: pc.localDescription?.sdp ?? offer.sdp,
  });
  if (!res.ok) {
    pc.close();
    throw new Error(`whep_${res.status}`);
  }
  const location = res.headers.get('Location');
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
  const resource = location ? new URL(location, url).toString() : null;
  return {
    pc,
    stop: () => {
      pc.close();
      if (resource) void fetch(resource, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    },
  };
}

/**
 * Fase 2 (STREAM_MODE=REAL): mientras `active`, abre el video WHEP de baja latencia y el
 * WebSocket de control hacia el bridge, y envía el estado del mando a 60 Hz.
 */
export function useRealSession(active: boolean, read: () => GamepadState): RealSession {
  const [s, setS] = useState<RealSession>({
    bridge: 'idle',
    video: 'idle',
    stream: null,
    inputRttMs: null,
    videoRttMs: null,
    blocked: [],
    error: null,
  });
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    if (!active) {
      setS((p) => ({ ...p, bridge: 'idle', video: 'idle', stream: null }));
      return;
    }
    let disposed = false;
    let ws: WebSocket | null = null;
    let whep: { pc: RTCPeerConnection; stop: () => void } | null = null;
    const timers: number[] = [];
    let attempts = 0;
    const patch = (p: Partial<RealSession>) => !disposed && setS((prev) => ({ ...prev, ...p }));

    const connectBridge = (creds: Credentials) => {
      patch({ bridge: attempts ? 'reconnecting' : 'connecting' });
      ws = new WebSocket(creds.bridgeUrl);
      ws.binaryType = 'arraybuffer';
      let seq = 0;
      let pingSeq = 0;
      let last: GamepadState | null = null;
      let lastSent = 0;
      let sender = 0;
      let pinger = 0;

      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token: creds.bridgeToken }));
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          const msg = JSON.parse(ev.data) as { type: string; always_blocked?: string[] };
          if (msg.type === 'ready') {
            attempts = 0;
            patch({ bridge: 'ready', blocked: msg.always_blocked ?? [], error: null });
            sender = window.setInterval(() => {
              if (ws?.readyState !== WebSocket.OPEN) return;
              const st = readRef.current();
              const now = performance.now();
              // Reenvío cada 100 ms aunque no cambie: el bridge suelta todo a los 500 ms sin frames.
              if (!last || !statesEqual(st, last) || now - lastSent > 100) {
                ws.send(encodeState(seq++, st));
                last = st;
                lastSent = now;
              }
            }, 16);
            pinger = window.setInterval(() => {
              if (ws?.readyState === WebSocket.OPEN) ws.send(encodePing(pingSeq++, Math.floor(performance.now())));
            }, 1000);
            timers.push(sender, pinger);
          }
          if (msg.type === 'kicked') patch({ bridge: 'kicked' });
          return;
        }
        const f = decodeFrame(ev.data as ArrayBuffer);
        if (f && f.type === FrameType.Pong) {
          const rtt = (Math.floor(performance.now()) - f.timestamp) >>> 0;
          if (rtt < 10_000) patch({ inputRttMs: rtt });
        }
      };
      ws.onclose = (ev) => {
        window.clearInterval(sender);
        window.clearInterval(pinger);
        if (disposed) return;
        if (ev.code === 4410 || ev.code === 4403) {
          patch({ bridge: 'kicked' });
          return;
        }
        if (attempts < 5) {
          attempts++;
          patch({ bridge: 'reconnecting' });
          timers.push(
            window.setTimeout(async () => {
              try {
                connectBridge(await fetchCredentials());
              } catch (e) {
                patch({ bridge: 'error', error: e instanceof Error ? e.message : 'bridge_error' });
              }
            }, 500 * attempts),
          );
        } else {
          patch({ bridge: 'error', error: 'bridge_unreachable' });
        }
      };
    };

    (async () => {
      try {
        const creds = await fetchCredentials();
        if (disposed) return;
        connectBridge(creds);

        // Renovación del token del bridge (vence a los 60 s).
        timers.push(
          window.setInterval(async () => {
            try {
              const fresh = await fetchCredentials();
              if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'auth', token: fresh.bridgeToken }));
            } catch {
              // si ya no tengo el turno, el bridge corta solo al vencer el token
            }
          }, 30_000),
        );

        patch({ video: 'connecting' });
        whep = await startWhep(creds.whepUrl, creds.streamToken, creds.iceServers, (stream) => patch({ stream, video: 'ready' }));
        timers.push(
          window.setInterval(async () => {
            if (!whep) return;
            const stats = await whep.pc.getStats();
            stats.forEach((r) => {
              if (r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') {
                patch({ videoRttMs: Math.round(r.currentRoundTripTime * 1000) });
              }
            });
          }, 2000),
        );
      } catch (e) {
        patch({ error: e instanceof Error ? e.message : 'session_error', video: 'error' });
      }
    })();

    return () => {
      disposed = true;
      timers.forEach((t) => {
        window.clearInterval(t);
        window.clearTimeout(t);
      });
      ws?.close(1000, 'turn_end');
      whep?.stop();
    };
  }, [active]);

  return s;
}
