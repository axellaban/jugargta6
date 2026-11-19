// Id anónimo por navegador para métricas de visitantes únicos. Nunca se usa para identificar personas.
const KEY = 'jg_visitor_id';
let memory: string | null = null;

function random(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `v-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function getVisitorId(): string {
  if (memory) return memory;
  if (typeof window === 'undefined') return 'server-render';
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved && saved.length >= 8) return (memory = saved);
    const id = random();
    window.localStorage.setItem(KEY, id);
    return (memory = id);
  } catch {
    return (memory = random());
  }
}

export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // modo privado / storage bloqueado: no pasa nada
  }
}
