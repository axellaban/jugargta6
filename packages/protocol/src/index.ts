/**
 * @jugargta/protocol — frame binario de 16 bytes para inputs de mando.
 *
 * Compartido por el navegador (apps/web) y el bridge (bridge/protocol.py).
 * Todo little-endian. Los ejes usan la convención XInput: Y positivo = arriba.
 *
 * | Byte  | Campo   | Tipo | Notas                                         |
 * | ----- | ------- | ---- | --------------------------------------------- |
 * | 0     | version | u8   | PROTOCOL_VERSION (1)                          |
 * | 1     | type    | u8   | FrameType                                     |
 * | 2-3   | seq     | u16  | incrementa por frame, da la vuelta en 65535   |
 * | 4-5   | buttons | u16  | bitmask, ver Button                           |
 * | 6     | lt      | u8   | gatillo izquierdo 0-255                       |
 * | 7     | rt      | u8   | gatillo derecho 0-255                         |
 * | 8-9   | lx      | i16  | -32768..32767                                 |
 * | 10-11 | ly      | i16  | positivo = arriba                             |
 * | 12-13 | rx      | i16  |                                               |
 * | 14-15 | ry      | i16  | positivo = arriba                             |
 *
 * Frames PING/PONG: bytes 4-7 = u32 timestamp del cliente (ms mod 2^32), resto en 0.
 *
 * Este archivo no tiene imports relativos a propósito: se consume tal cual desde
 * Next.js (transpilePackages) y desde Node (type stripping) sin paso de build.
 */

export const PROTOCOL_VERSION = 1;
export const FRAME_SIZE = 16;

export const FrameType = {
  State: 1,
  Ping: 2,
  Pong: 3,
} as const;
export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType];

/** Índice de bit de cada botón dentro de `buttons`. */
export const Button = {
  A: 0, // Cross
  B: 1, // Circle
  X: 2, // Square
  Y: 3, // Triangle
  LB: 4, // L1
  RB: 5, // R1
  Back: 6, // View / Share / Create
  Start: 7, // Menu / Options
  LS: 8, // L3
  RS: 9, // R3
  Up: 10,
  Down: 11,
  Left: 12,
  Right: 13,
  Guide: 14, // Xbox / PS
  Touchpad: 15,
} as const;
export type ButtonName = keyof typeof Button;
export const BUTTON_NAMES = Object.keys(Button) as ButtonName[];

/** Etiquetas para mostrar en la UI según la familia de mando. */
export const BUTTON_LABELS: Record<ButtonName, { xbox: string; ps: string }> = {
  A: { xbox: 'A', ps: '✕' },
  B: { xbox: 'B', ps: '○' },
  X: { xbox: 'X', ps: '□' },
  Y: { xbox: 'Y', ps: '△' },
  LB: { xbox: 'LB', ps: 'L1' },
  RB: { xbox: 'RB', ps: 'R1' },
  Back: { xbox: 'View', ps: 'Create' },
  Start: { xbox: 'Menu', ps: 'Options' },
  LS: { xbox: 'LS', ps: 'L3' },
  RS: { xbox: 'RS', ps: 'R3' },
  Up: { xbox: '↑', ps: '↑' },
  Down: { xbox: '↓', ps: '↓' },
  Left: { xbox: '←', ps: '←' },
  Right: { xbox: '→', ps: '→' },
  Guide: { xbox: 'Xbox', ps: 'PS' },
  Touchpad: { xbox: '—', ps: 'Touchpad' },
};

/**
 * Filtro anti-troll por consola. Lo aplica el bridge (fuente de verdad); la web
 * lo usa solo para marcar en el HUD qué botones no llegan a la consola.
 *  - always: bloqueados siempre (menú de sistema, capturas, transmisiones).
 *  - hold:   permitidos solo como toque corto; el bridge los suelta pasado HOLD_LIMIT_MS.
 * En PS5, Back = Create/Share (sistema). En Xbox, Back = View (cámara en el juego).
 */
export const FILTER_PROFILES = {
  ps5: { always: ['Guide', 'Back'], hold: ['Start'] },
  xbox: { always: ['Guide'], hold: ['Start'] },
} as const satisfies Record<string, { always: readonly ButtonName[]; hold: readonly ButtonName[] }>;
export type ConsoleProfile = keyof typeof FILTER_PROFILES;
export const HOLD_LIMIT_MS = 800;

export interface GamepadState {
  buttons: number; // u16
  lt: number; // u8
  rt: number; // u8
  lx: number; // i16
  ly: number; // i16
  rx: number; // i16
  ry: number; // i16
}

export type Frame =
  | { version: number; type: typeof FrameType.State; seq: number; state: GamepadState }
  | { version: number; type: typeof FrameType.Ping | typeof FrameType.Pong; seq: number; timestamp: number };

export function neutralState(): GamepadState {
  return { buttons: 0, lt: 0, rt: 0, lx: 0, ly: 0, rx: 0, ry: 0 };
}

export function setButton(mask: number, button: ButtonName, pressed: boolean): number {
  const bit = 1 << Button[button];
  return (pressed ? mask | bit : mask & ~bit) & 0xffff;
}

export function isPressed(mask: number, button: ButtonName): boolean {
  return (mask & (1 << Button[button])) !== 0;
}

export function pressedButtons(mask: number): ButtonName[] {
  return BUTTON_NAMES.filter((name) => isPressed(mask, name));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** [-1, 1] → i16. */
export function axisToI16(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const v = clamp(value, -1, 1);
  return v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
}

/** [0, 1] → u8. */
export function triggerToU8(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(clamp(value, 0, 1) * 255);
}

function normalizeState(s: GamepadState): GamepadState {
  return {
    buttons: s.buttons & 0xffff,
    lt: clamp(Math.round(s.lt), 0, 255),
    rt: clamp(Math.round(s.rt), 0, 255),
    lx: clamp(Math.round(s.lx), -32768, 32767),
    ly: clamp(Math.round(s.ly), -32768, 32767),
    rx: clamp(Math.round(s.rx), -32768, 32767),
    ry: clamp(Math.round(s.ry), -32768, 32767),
  };
}

export function encodeState(seq: number, state: GamepadState): Uint8Array {
  const s = normalizeState(state);
  const buf = new Uint8Array(FRAME_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, FrameType.State);
  view.setUint16(2, seq & 0xffff, true);
  view.setUint16(4, s.buttons, true);
  view.setUint8(6, s.lt);
  view.setUint8(7, s.rt);
  view.setInt16(8, s.lx, true);
  view.setInt16(10, s.ly, true);
  view.setInt16(12, s.rx, true);
  view.setInt16(14, s.ry, true);
  return buf;
}

function encodeTimed(type: number, seq: number, timestamp: number): Uint8Array {
  const buf = new Uint8Array(FRAME_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, type);
  view.setUint16(2, seq & 0xffff, true);
  view.setUint32(4, Math.floor(timestamp) >>> 0, true);
  return buf;
}

export function encodePing(seq: number, timestamp: number): Uint8Array {
  return encodeTimed(FrameType.Ping, seq, timestamp);
}

export function encodePong(seq: number, timestamp: number): Uint8Array {
  return encodeTimed(FrameType.Pong, seq, timestamp);
}

/** Devuelve null si el frame es inválido (tamaño, versión o tipo). */
export function decodeFrame(data: ArrayBuffer | ArrayBufferView): Frame | null {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength !== FRAME_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, FRAME_SIZE);
  const version = view.getUint8(0);
  if (version !== PROTOCOL_VERSION) return null;
  const type = view.getUint8(1);
  const seq = view.getUint16(2, true);
  if (type === FrameType.State) {
    return {
      version,
      type,
      seq,
      state: {
        buttons: view.getUint16(4, true),
        lt: view.getUint8(6),
        rt: view.getUint8(7),
        lx: view.getInt16(8, true),
        ly: view.getInt16(10, true),
        rx: view.getInt16(12, true),
        ry: view.getInt16(14, true),
      },
    };
  }
  if (type === FrameType.Ping || type === FrameType.Pong) {
    return { version, type, seq, timestamp: view.getUint32(4, true) };
  }
  return null;
}

/** true si `seq` es posterior a `last` considerando la vuelta de u16. */
export function isNewerSeq(seq: number, last: number): boolean {
  const diff = (seq - last + 0x10000) & 0xffff;
  return diff !== 0 && diff < 0x8000;
}

export function statesEqual(a: GamepadState, b: GamepadState): boolean {
  return (
    a.buttons === b.buttons &&
    a.lt === b.lt &&
    a.rt === b.rt &&
    a.lx === b.lx &&
    a.ly === b.ly &&
    a.rx === b.rx &&
    a.ry === b.ry
  );
}

/** Combina varias fuentes (mando + teclado + táctil): OR de botones, máximo por eje. */
export function mergeStates(states: GamepadState[]): GamepadState {
  const out = neutralState();
  const pickAxis = (a: number, b: number) => (Math.abs(b) > Math.abs(a) ? b : a);
  for (const s of states) {
    out.buttons |= s.buttons;
    out.lt = Math.max(out.lt, s.lt);
    out.rt = Math.max(out.rt, s.rt);
    out.lx = pickAxis(out.lx, s.lx);
    out.ly = pickAxis(out.ly, s.ly);
    out.rx = pickAxis(out.rx, s.rx);
    out.ry = pickAxis(out.ry, s.ry);
  }
  out.buttons &= 0xffff;
  return out;
}

// ---------------------------------------------------------------------------
// Fuentes de input
// ---------------------------------------------------------------------------

/** Subconjunto de la Gamepad API que usamos (facilita tests sin navegador). */
export interface GamepadLike {
  mapping?: string;
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
  axes: ReadonlyArray<number>;
}

/** Orden W3C "standard" → nuestros bits. Los índices 6 y 7 (gatillos) son analógicos. */
const STANDARD_BUTTON_MAP: Array<[number, ButtonName]> = [
  [0, 'A'],
  [1, 'B'],
  [2, 'X'],
  [3, 'Y'],
  [4, 'LB'],
  [5, 'RB'],
  [8, 'Back'],
  [9, 'Start'],
  [10, 'LS'],
  [11, 'RS'],
  [12, 'Up'],
  [13, 'Down'],
  [14, 'Left'],
  [15, 'Right'],
  [16, 'Guide'],
  [17, 'Touchpad'],
];

function applyDeadzone(x: number, y: number, deadzone: number): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return [0, 0];
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return [(x / mag) * scaled, (y / mag) * scaled];
}

export function fromStandardGamepad(gp: GamepadLike, deadzone = 0.1): GamepadState {
  let buttons = 0;
  for (const [index, name] of STANDARD_BUTTON_MAP) {
    if (gp.buttons[index]?.pressed) buttons = setButton(buttons, name, true);
  }
  // Gatillo analógico; si el mando solo informa digital (value 0 con pressed), vale 1.
  const trigger = (b?: { pressed: boolean; value: number }) => (!b ? 0 : b.value > 0 ? b.value : b.pressed ? 1 : 0);
  const lt = trigger(gp.buttons[6]);
  const rt = trigger(gp.buttons[7]);
  const [lx, ly] = applyDeadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0, deadzone);
  const [rx, ry] = applyDeadzone(gp.axes[2] ?? 0, gp.axes[3] ?? 0, deadzone);
  return {
    buttons,
    lt: triggerToU8(lt),
    rt: triggerToU8(rt),
    lx: axisToI16(lx),
    ly: axisToI16(-ly), // W3C: arriba es negativo; protocolo: arriba es positivo
    rx: axisToI16(rx),
    ry: axisToI16(-ry),
  };
}

export type KeyTarget =
  | { kind: 'button'; button: ButtonName }
  | { kind: 'trigger'; trigger: 'lt' | 'rt' }
  | { kind: 'axis'; axis: 'lx' | 'ly' | 'rx' | 'ry'; direction: 1 | -1 };

/** Mapeo por defecto teclado/mouse → mando. Claves = KeyboardEvent.code o "Mouse0/Mouse2". */
export const DEFAULT_KEYMAP: Record<string, KeyTarget> = {
  KeyW: { kind: 'axis', axis: 'ly', direction: 1 },
  KeyS: { kind: 'axis', axis: 'ly', direction: -1 },
  KeyA: { kind: 'axis', axis: 'lx', direction: -1 },
  KeyD: { kind: 'axis', axis: 'lx', direction: 1 },
  ArrowUp: { kind: 'axis', axis: 'ry', direction: 1 },
  ArrowDown: { kind: 'axis', axis: 'ry', direction: -1 },
  ArrowLeft: { kind: 'axis', axis: 'rx', direction: -1 },
  ArrowRight: { kind: 'axis', axis: 'rx', direction: 1 },
  Space: { kind: 'button', button: 'A' },
  KeyC: { kind: 'button', button: 'B' },
  KeyR: { kind: 'button', button: 'X' },
  KeyF: { kind: 'button', button: 'Y' },
  KeyQ: { kind: 'button', button: 'LB' },
  KeyE: { kind: 'button', button: 'RB' },
  KeyJ: { kind: 'trigger', trigger: 'lt' },
  KeyK: { kind: 'trigger', trigger: 'rt' },
  Mouse2: { kind: 'trigger', trigger: 'lt' },
  Mouse0: { kind: 'trigger', trigger: 'rt' },
  KeyZ: { kind: 'button', button: 'LS' },
  KeyX: { kind: 'button', button: 'RS' },
  Digit1: { kind: 'button', button: 'Up' },
  Digit2: { kind: 'button', button: 'Down' },
  Digit3: { kind: 'button', button: 'Left' },
  Digit4: { kind: 'button', button: 'Right' },
  Enter: { kind: 'button', button: 'Start' },
  Tab: { kind: 'button', button: 'Back' },
};

/** Etiqueta legible de una tecla del keymap. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const special: Record<string, string> = {
    Space: 'Espacio',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: 'Enter',
    Tab: 'Tab',
    Mouse0: 'Clic izq.',
    Mouse2: 'Clic der.',
  };
  return special[code] ?? code;
}

export function fromKeys(pressed: Iterable<string>, keymap: Record<string, KeyTarget> = DEFAULT_KEYMAP): GamepadState {
  const s = neutralState();
  const axes = { lx: 0, ly: 0, rx: 0, ry: 0 };
  for (const code of pressed) {
    const target = keymap[code];
    if (!target) continue;
    if (target.kind === 'button') s.buttons = setButton(s.buttons, target.button, true);
    else if (target.kind === 'trigger') s[target.trigger] = 255;
    else axes[target.axis] += target.direction;
  }
  // Diagonales normalizadas (W+D no es más rápido que W).
  const norm = (x: number, y: number): [number, number] => {
    const m = Math.hypot(x, y);
    return m > 1 ? [x / m, y / m] : [x, y];
  };
  const [lx, ly] = norm(axes.lx, axes.ly);
  const [rx, ry] = norm(axes.rx, axes.ry);
  s.lx = axisToI16(lx);
  s.ly = axisToI16(ly);
  s.rx = axisToI16(rx);
  s.ry = axisToI16(ry);
  return s;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
