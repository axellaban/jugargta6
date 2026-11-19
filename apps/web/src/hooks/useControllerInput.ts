'use client';

import {
  DEFAULT_KEYMAP,
  fromKeys,
  fromStandardGamepad,
  mergeStates,
  neutralState,
  statesEqual,
  type GamepadState,
} from '@jugargta/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

export type InputSource = 'gamepad' | 'keyboard' | 'touch';

export interface ControllerInfo {
  connected: boolean;
  id: string;
  family: 'xbox' | 'ps' | 'generic';
  standard: boolean;
}

export interface ControllerInput {
  /** Estado combinado, actualizado como máximo ~30 veces por segundo (para dibujar). */
  state: GamepadState;
  /** Lectura instantánea para quien envía frames (sin re-render). */
  read: () => GamepadState;
  gamepad: ControllerInfo | null;
  lastSource: InputSource | null;
  setTouchState: (s: GamepadState) => void;
  /** Ref para el elemento donde los clics cuentan como gatillos (el reproductor). */
  bindMouseTarget: (el: HTMLElement | null) => void;
}

function familyOf(id: string): ControllerInfo['family'] {
  const s = id.toLowerCase();
  if (s.includes('054c') || s.includes('dualsense') || s.includes('dualshock') || s.includes('playstation') || s.includes('wireless controller')) return 'ps';
  if (s.includes('xbox') || s.includes('045e') || s.includes('xinput')) return 'xbox';
  return 'generic';
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * Captura Gamepad API + teclado/mouse + táctil y los combina en un solo GamepadState.
 * Solo escucha mientras `active` es true (entrenador abierto o turno en curso).
 */
export function useControllerInput(active: boolean): ControllerInput {
  const keysRef = useRef<Set<string>>(new Set());
  const touchRef = useRef<GamepadState>(neutralState());
  const padRef = useRef<GamepadState>(neutralState());
  const mergedRef = useRef<GamepadState>(neutralState());
  const [state, setState] = useState<GamepadState>(neutralState());
  const [gamepad, setGamepad] = useState<ControllerInfo | null>(null);
  const [lastSource, setLastSource] = useState<InputSource | null>(null);
  const [mouseEl, setMouseEl] = useState<HTMLElement | null>(null);
  const lastPaintRef = useRef(0);

  const recompute = useCallback((source?: InputSource) => {
    const keyState = fromKeys(keysRef.current);
    const merged = mergeStates([padRef.current, keyState, touchRef.current]);
    if (!statesEqual(merged, mergedRef.current)) {
      mergedRef.current = merged;
      if (source) setLastSource(source);
      const now = performance.now();
      if (now - lastPaintRef.current > 33) {
        lastPaintRef.current = now;
        setState(merged);
      }
    }
  }, []);

  // Teclado
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (!(e.code in DEFAULT_KEYMAP)) return;
      e.preventDefault();
      keysRef.current.add(e.code);
      recompute('keyboard');
    };
    const up = (e: KeyboardEvent) => {
      if (!keysRef.current.delete(e.code)) return;
      e.preventDefault();
      recompute('keyboard');
    };
    const blur = () => {
      keysRef.current.clear();
      recompute();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      keysRef.current.clear();
      recompute();
    };
  }, [active, recompute]);

  // Mouse (solo sobre el reproductor): clic izq. = RT, clic der. = LT
  const bindMouseTarget = useCallback((el: HTMLElement | null) => setMouseEl(el), []);
  useEffect(() => {
    const el = mouseEl;
    if (!active || !el) return;
    const code = (b: number) => (b === 0 ? 'Mouse0' : b === 2 ? 'Mouse2' : null);
    const down = (e: MouseEvent) => {
      const c = code(e.button);
      if (!c) return;
      keysRef.current.add(c);
      recompute('keyboard');
    };
    const up = (e: MouseEvent) => {
      const c = code(e.button);
      if (c && keysRef.current.delete(c)) recompute('keyboard');
    };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      el.removeEventListener('contextmenu', ctx);
    };
  }, [active, mouseEl, recompute]);

  // Gamepad API: polling por requestAnimationFrame
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let raf = 0;
    let lastId = '';
    const loop = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const gp = Array.from(pads).find((p): p is Gamepad => Boolean(p && p.connected));
      if (gp) {
        if (gp.id !== lastId) {
          lastId = gp.id;
          setGamepad({ connected: true, id: gp.id, family: familyOf(gp.id), standard: gp.mapping === 'standard' });
        }
        const s = fromStandardGamepad(gp);
        if (!statesEqual(s, padRef.current)) {
          padRef.current = s;
          recompute('gamepad');
        }
      } else if (lastId) {
        lastId = '';
        setGamepad(null);
        padRef.current = neutralState();
        recompute();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onConnect = () => undefined; // el loop lo detecta; el evento "despierta" la API en algunos navegadores
    window.addEventListener('gamepadconnected', onConnect);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('gamepadconnected', onConnect);
      padRef.current = neutralState();
    };
  }, [active, recompute]);

  // Pintar el último estado aunque haya caído dentro del throttle
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setState((prev) => (statesEqual(prev, mergedRef.current) ? prev : mergedRef.current));
    }, 50);
    return () => window.clearInterval(id);
  }, [active]);

  const setTouchState = useCallback(
    (s: GamepadState) => {
      touchRef.current = s;
      recompute('touch');
    },
    [recompute],
  );

  const read = useCallback(() => mergedRef.current, []);

  return { state, read, gamepad, lastSource, setTouchState, bindMouseTarget };
}
