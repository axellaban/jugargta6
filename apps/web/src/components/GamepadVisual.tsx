'use client';

import { BUTTON_LABELS, isPressed, type ButtonName, type GamepadState } from '@jugargta/protocol';

const ON = 'var(--color-accent)';
const OFF = 'var(--color-panel-3)';
const STROKE = 'var(--color-border)';
const BLOCKED = 'var(--color-live)';

/** Dibujo de un mando genérico que refleja en vivo botones, gatillos y sticks. */
export function GamepadVisual({
  state,
  family = 'xbox',
  blocked = [],
  className = '',
}: {
  state: GamepadState;
  family?: 'xbox' | 'ps' | 'generic';
  blocked?: readonly ButtonName[];
  className?: string;
}) {
  const fam = family === 'ps' ? 'ps' : 'xbox';
  const label = (b: ButtonName) => BUTTON_LABELS[b][fam];
  const p = (b: ButtonName) => isPressed(state.buttons, b);
  const fill = (b: ButtonName) => (p(b) ? (blocked.includes(b) ? BLOCKED : ON) : OFF);
  const stroke = (b: ButtonName) => (blocked.includes(b) ? BLOCKED : STROKE);

  const face: Array<[ButtonName, number, number]> = [
    ['Y', 300, 78],
    ['X', 274, 104],
    ['B', 326, 104],
    ['A', 300, 130],
  ];
  const dpad: Array<[ButtonName, number, number, number, number]> = [
    ['Up', 140, 132, 18, 22],
    ['Down', 140, 176, 18, 22],
    ['Left', 116, 156, 22, 18],
    ['Right', 160, 156, 22, 18],
  ];
  const stick = (cx: number, cy: number, x: number, y: number, pressed: boolean, name: string) => (
    <g>
      <circle cx={cx} cy={cy} r={27} fill="var(--color-panel-2)" stroke={STROKE} strokeWidth={2} />
      <circle cx={cx + (x / 32767) * 14} cy={cy - (y / 32767) * 14} r={16} fill={pressed ? ON : OFF} stroke={STROKE} strokeWidth={2} />
      <text x={cx} y={cy + 42} textAnchor="middle" fontSize={9} fill="var(--color-faint)">
        {name}
      </text>
    </g>
  );
  const trigger = (x: number, value: number, name: string) => (
    <g>
      <rect x={x} y={6} width={70} height={12} rx={6} fill="var(--color-panel-2)" stroke={STROKE} />
      <rect x={x} y={6} width={(value / 255) * 70} height={12} rx={6} fill={ON} />
      <text x={x + 35} y={15} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--color-text)">
        {name}
      </text>
    </g>
  );

  return (
    <svg viewBox="0 0 400 240" className={className} role="img" aria-label="Estado del mando">
      {trigger(66, state.lt, fam === 'ps' ? 'L2' : 'LT')}
      {trigger(264, state.rt, fam === 'ps' ? 'R2' : 'RT')}
      <rect x={66} y={24} width={70} height={14} rx={7} fill={fill('LB')} stroke={STROKE} />
      <text x={101} y={34} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--color-text)">{label('LB')}</text>
      <rect x={264} y={24} width={70} height={14} rx={7} fill={fill('RB')} stroke={STROKE} />
      <text x={299} y={34} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--color-text)">{label('RB')}</text>

      <path
        d="M70 52 Q200 30 330 52 Q372 60 384 120 Q398 196 360 218 Q332 232 300 196 L272 168 L128 168 L100 196 Q68 232 40 218 Q2 196 16 120 Q28 60 70 52 Z"
        fill="var(--color-panel)"
        stroke={STROKE}
        strokeWidth={2}
      />

      {stick(96, 104, state.lx, state.ly, p('LS'), label('LS'))}
      {stick(250, 156, state.rx, state.ry, p('RS'), label('RS'))}

      {dpad.map(([b, x, y, w, h]) => (
        <rect key={b} x={x - w / 2} y={y - h / 2} width={w} height={h} rx={3} fill={fill(b)} stroke={stroke(b)} strokeWidth={1.5} />
      ))}

      {face.map(([b, x, y]) => (
        <g key={b}>
          <circle cx={x} cy={y} r={12} fill={fill(b)} stroke={stroke(b)} strokeWidth={1.5} />
          <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--color-text)">{label(b)}</text>
        </g>
      ))}

      {(['Back', 'Start'] as ButtonName[]).map((b, i) => (
        <g key={b}>
          <rect x={i ? 214 : 162} y={92} width={24} height={12} rx={6} fill={fill(b)} stroke={stroke(b)} strokeWidth={1.5} />
          <text x={i ? 226 : 174} y={116} textAnchor="middle" fontSize={8} fill="var(--color-faint)">{label(b)}</text>
        </g>
      ))}
      <circle cx={200} cy={70} r={11} fill={fill('Guide')} stroke={stroke('Guide')} strokeWidth={1.5} />
      <text x={200} y={74} textAnchor="middle" fontSize={7} fontWeight={800} fill="var(--color-text)">{label('Guide')}</text>
      {fam === 'ps' && (
        <rect x={176} y={124} width={48} height={20} rx={5} fill={fill('Touchpad')} stroke={stroke('Touchpad')} strokeWidth={1.5} />
      )}
    </svg>
  );
}
