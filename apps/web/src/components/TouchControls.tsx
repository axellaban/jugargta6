'use client';

import { axisToI16, neutralState, setButton, type ButtonName, type GamepadState } from '@jugargta/protocol';
import { useEffect, useRef, useState } from 'react';

function Stick({ onMove, label }: { onMove: (x: number, y: number) => void; label: string }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const center = useRef({ x: 0, y: 0 });
  const R = 44;
  const move = (e: React.PointerEvent) => {
    let dx = (e.clientX - center.current.x) / R;
    let dy = (e.clientY - center.current.y) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    setKnob({ x: dx, y: dy });
    onMove(dx, -dy);
  };
  const end = () => {
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };
  return (
    <div
      className="pointer-events-auto relative grid size-28 place-items-center rounded-full border border-white/20 bg-black/35 backdrop-blur-sm"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && move(e)}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label={label}
    >
      <div
        className="size-12 rounded-full bg-white/70 shadow-lg"
        style={{ transform: `translate(${knob.x * R}px, ${knob.y * R}px)` }}
      />
    </div>
  );
}

function Btn({ label, onPress, className = '' }: { label: string; onPress: (down: boolean) => void; className?: string }) {
  const [down, setDown] = useState(false);
  const set = (v: boolean) => {
    setDown(v);
    onPress(v);
  };
  return (
    <button
      type="button"
      className={`pointer-events-auto grid place-items-center rounded-full border border-white/25 text-sm font-black text-white backdrop-blur-sm transition ${down ? 'scale-95 bg-accent/80' : 'bg-black/40'} ${className}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

/** Mando táctil para celulares: dos sticks virtuales + botones. */
export function TouchControls({ onChange, family = 'xbox' }: { onChange: (s: GamepadState) => void; family?: 'xbox' | 'ps' | 'generic' }) {
  const st = useRef<GamepadState>(neutralState());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const emit = () => onChangeRef.current({ ...st.current });
  const btn = (b: ButtonName) => (v: boolean) => {
    st.current.buttons = setButton(st.current.buttons, b, v);
    emit();
  };
  const trig = (t: 'lt' | 'rt') => (v: boolean) => {
    st.current[t] = v ? 255 : 0;
    emit();
  };
  const stick = (side: 'l' | 'r') => (x: number, y: number) => {
    if (side === 'l') {
      st.current.lx = axisToI16(x);
      st.current.ly = axisToI16(y);
    } else {
      st.current.rx = axisToI16(x);
      st.current.ry = axisToI16(y);
    }
    emit();
  };
  useEffect(() => () => onChangeRef.current(neutralState()), []);
  const ps = family === 'ps';

  return (
    <div className="touch-none-select pointer-events-none absolute inset-0 z-20">
      <div className="absolute left-3 top-12 flex gap-2">
        <Btn label={ps ? 'L2' : 'LT'} onPress={trig('lt')} className="h-9 w-14 rounded-xl text-xs" />
        <Btn label={ps ? 'L1' : 'LB'} onPress={btn('LB')} className="h-9 w-14 rounded-xl text-xs" />
      </div>
      <div className="absolute right-3 top-12 flex gap-2">
        <Btn label={ps ? 'R1' : 'RB'} onPress={btn('RB')} className="h-9 w-14 rounded-xl text-xs" />
        <Btn label={ps ? 'R2' : 'RT'} onPress={trig('rt')} className="h-9 w-14 rounded-xl text-xs" />
      </div>
      <div className="absolute bottom-3 left-3">
        <Stick label="Stick izquierdo" onMove={stick('l')} />
      </div>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
        <Btn label="▲" onPress={btn('Up')} className="size-9 text-xs" />
        <Btn label="◀" onPress={btn('Left')} className="size-9 text-xs" />
        <Btn label="▶" onPress={btn('Right')} className="size-9 text-xs" />
        <Btn label="▼" onPress={btn('Down')} className="size-9 text-xs" />
        <Btn label="≡" onPress={btn('Start')} className="size-9 text-xs" />
      </div>
      <div className="absolute bottom-3 right-3 flex items-end gap-3">
        <div className="hidden sm:block">
          <Stick label="Stick derecho" onMove={stick('r')} />
        </div>
        <div className="relative size-32">
          <Btn label={ps ? '△' : 'Y'} onPress={btn('Y')} className="absolute left-1/2 top-0 size-11 -translate-x-1/2" />
          <Btn label={ps ? '□' : 'X'} onPress={btn('X')} className="absolute left-0 top-1/2 size-11 -translate-y-1/2" />
          <Btn label={ps ? '○' : 'B'} onPress={btn('B')} className="absolute right-0 top-1/2 size-11 -translate-y-1/2" />
          <Btn label={ps ? '✕' : 'A'} onPress={btn('A')} className="absolute bottom-0 left-1/2 size-11 -translate-x-1/2" />
        </div>
      </div>
    </div>
  );
}
