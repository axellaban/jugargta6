import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FRAME_SIZE, FrameType, decodeFrame, encodePing, encodePong, encodeState, fromHex, fromKeys,
  fromStandardGamepad, isNewerSeq, isPressed, mergeStates, neutralState, pressedButtons, setButton, toHex,
} from '../src/index.ts';

const vectors = JSON.parse(readFileSync(new URL('../test-vectors.json', import.meta.url), 'utf8'));

test('vectores válidos: encode y decode coinciden byte a byte', () => {
  for (const v of vectors.valid) {
    const bytes =
      v.type === 'state' ? encodeState(v.seq, v.state)
      : v.type === 'ping' ? encodePing(v.seq, v.timestamp)
      : encodePong(v.seq, v.timestamp);
    assert.equal(bytes.byteLength, FRAME_SIZE, v.name);
    assert.equal(toHex(bytes), v.hex, v.name);
    const frame = decodeFrame(fromHex(v.hex));
    assert.ok(frame, v.name);
    assert.equal(frame.seq, v.seq);
    if (frame.type === FrameType.State) assert.deepEqual(frame.state, v.state, v.name);
    else assert.equal(frame.timestamp, v.timestamp, v.name);
  }
});

test('vectores inválidos devuelven null', () => {
  for (const v of vectors.invalid) assert.equal(decodeFrame(fromHex(v.hex)), null, v.name);
});

test('encode satura valores fuera de rango', () => {
  const f = decodeFrame(encodeState(70000, { buttons: 0x1ffff, lt: 999, rt: -5, lx: 99999, ly: -99999, rx: 1.4, ry: 0 }));
  assert.ok(f && f.type === FrameType.State);
  assert.equal(f.seq, 70000 & 0xffff);
  assert.deepEqual(f.state, { buttons: 0xffff, lt: 255, rt: 0, lx: 32767, ly: -32768, rx: 1, ry: 0 });
});

test('decode acepta vistas con offset', () => {
  const big = new Uint8Array(32);
  big.set(encodeState(5, { ...neutralState(), buttons: 3 }), 8);
  const f = decodeFrame(big.subarray(8, 24));
  assert.ok(f && f.type === FrameType.State && f.state.buttons === 3);
});

test('isNewerSeq con vuelta de u16', () => {
  assert.equal(isNewerSeq(1, 0), true);
  assert.equal(isNewerSeq(0, 65535), true);
  assert.equal(isNewerSeq(65535, 0), false);
  assert.equal(isNewerSeq(10, 10), false);
  assert.equal(isNewerSeq(5, 10), false);
});

test('botones', () => {
  let m = setButton(0, 'A', true);
  m = setButton(m, 'Guide', true);
  assert.deepEqual(pressedButtons(m), ['A', 'Guide']);
  m = setButton(m, 'A', false);
  assert.equal(isPressed(m, 'A'), false);
});

test('Gamepad API estándar → estado (Y invertido, deadzone, gatillos analógicos)', () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  buttons[0] = { pressed: true, value: 1 };
  buttons[7] = { pressed: true, value: 0.5 };
  buttons[16] = { pressed: true, value: 1 };
  const s = fromStandardGamepad({ mapping: 'standard', buttons, axes: [0.05, -1, 0, 0] }, 0.1);
  assert.equal(isPressed(s.buttons, 'A'), true);
  assert.equal(isPressed(s.buttons, 'Guide'), true);
  assert.equal(s.rt, 128);
  assert.equal(s.lt, 0);
  assert.ok(s.ly > 32000, 'arriba en W3C (-1) es positivo en el protocolo');
  assert.ok(Math.abs(s.lx) < 2000);
  const idle = fromStandardGamepad({ buttons, axes: [0.05, 0.05, -0.08, 0] }, 0.1);
  assert.equal(idle.lx, 0);
  assert.equal(idle.rx, 0);
});

test('teclado: WASD normaliza diagonales, mouse → gatillos', () => {
  const s = fromKeys(['KeyW', 'KeyD', 'Space', 'Mouse0']);
  assert.ok(Math.abs(s.lx - s.ly) <= 1);
  assert.ok(s.lx < 32767 && s.lx > 23000);
  assert.equal(isPressed(s.buttons, 'A'), true);
  assert.equal(s.rt, 255);
  const opposite = fromKeys(['KeyA', 'KeyD']);
  assert.equal(opposite.lx, 0);
});

test('mergeStates combina fuentes', () => {
  const a = { ...neutralState(), buttons: 1, lx: 1000, lt: 10 };
  const b = { ...neutralState(), buttons: 2, lx: -20000, rt: 200 };
  assert.deepEqual(mergeStates([a, b]), { buttons: 3, lt: 10, rt: 200, lx: -20000, ly: 0, rx: 0, ry: 0 });
});
