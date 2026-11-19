// Catálogo de productos. Los precios se pueden sobrescribir con PRODUCT_PRICES (JSON) para
// testear disposición a pagar sin tocar código: {"skip_queue":{"ARS":3000,"USD":3.49}}
import type { StreamMode } from './types.ts';

export type ProductCode = 'skip_queue' | 'extend_10' | 'vip_turn';

export interface Product {
  code: ProductCode;
  title: string;
  founderTitle: string;
  description: string;
  founderDescription: string;
  prices: Record<string, number>;
  highlight?: boolean;
}

export const PRODUCTS: Record<ProductCode, Product> = {
  skip_queue: {
    code: 'skip_queue',
    title: 'Saltar la fila',
    founderTitle: 'Pase Fundador · Salto de fila',
    description: 'Pasás al #1: jugás apenas termina el turno actual.',
    founderDescription: 'Reservás 1 salto de fila que se acredita cuando la consola esté online.',
    prices: { ARS: 2500, USD: 2.99 },
  },
  extend_10: {
    code: 'extend_10',
    title: '+10 minutos',
    founderTitle: 'Pase Fundador · +10 min',
    description: 'Sumá 10 minutos a tu turno (al actual o al próximo).',
    founderDescription: 'Reservás 10 minutos extra para tu primer turno con la consola online.',
    prices: { ARS: 2000, USD: 1.99 },
  },
  vip_turn: {
    code: 'vip_turn',
    title: 'Turno VIP',
    founderTitle: 'Pase Fundador · Turno VIP',
    description: 'Salto de fila + 10 minutos extra. El combo completo.',
    founderDescription: 'Reservás salto de fila + 10 min para cuando la consola esté online.',
    prices: { ARS: 4000, USD: 4.49 },
    highlight: true,
  },
};

export function isProductCode(v: unknown): v is ProductCode {
  return typeof v === 'string' && v in PRODUCTS;
}

export function priceFor(code: ProductCode, currency: string, overridesJson?: string): number | null {
  if (overridesJson) {
    try {
      const o = JSON.parse(overridesJson) as Record<string, Record<string, number>>;
      const v = o?.[code]?.[currency];
      if (typeof v === 'number' && v > 0) return v;
    } catch {
      // JSON inválido: se ignoran los overrides
    }
  }
  return PRODUCTS[code].prices[currency] ?? null;
}

export function productView(code: ProductCode, mode: StreamMode, currency: string, overridesJson?: string) {
  const p = PRODUCTS[code];
  const founder = mode === 'SIMULATED';
  return {
    code,
    title: founder ? p.founderTitle : p.title,
    description: founder ? p.founderDescription : p.description,
    price: priceFor(code, currency, overridesJson),
    currency,
    highlight: Boolean(p.highlight),
  };
}

export type ProductView = ReturnType<typeof productView>;

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'ARS' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** Texto obligatorio del checkout en Fase 1. */
export const FOUNDER_TERMS =
  'La consola todavía no está online. Esto es una reserva: el beneficio queda guardado en tu cuenta y se ' +
  'acredita automáticamente cuando encendamos la consola. Si cambiás de idea antes de usarlo, te devolvemos el 100%.';
