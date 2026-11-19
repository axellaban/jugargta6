// Variables de entorno del servidor. No importar desde componentes cliente.
import type { AppSettings, PublicConfig, StreamMode } from './types.ts';

const str = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export const env = {
  siteName: str(process.env.NEXT_PUBLIC_SITE_NAME) ?? 'JugarGTA6',
  appUrl: (str(process.env.NEXT_PUBLIC_APP_URL) ?? str(process.env.VERCEL_PROJECT_PRODUCTION_URL)?.replace(/^(?!https?:)/, 'https://') ?? 'http://localhost:3000').replace(/\/$/, ''),
  supabaseUrl: str(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: str(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? str(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  supabaseServiceKey: str(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? str(process.env.SUPABASE_SECRET_KEY),

  /** Techo del modo de stream. REAL requiere además bridge y WHEP configurados. */
  streamMode: (str(process.env.STREAM_MODE)?.toUpperCase() === 'REAL' ? 'REAL' : 'SIMULATED') as StreamMode,

  checkoutProvider: ((): 'mock' | 'mercadopago' | 'stripe' => {
    const v = str(process.env.CHECKOUT_PROVIDER)?.toLowerCase();
    return v === 'mercadopago' || v === 'stripe' ? v : 'mock';
  })(),
  mpAccessToken: str(process.env.MERCADOPAGO_ACCESS_TOKEN),
  mpWebhookSecret: str(process.env.MERCADOPAGO_WEBHOOK_SECRET),
  mpCurrency: str(process.env.MERCADOPAGO_CURRENCY) ?? 'ARS',
  stripeSecretKey: str(process.env.STRIPE_SECRET_KEY),
  stripeWebhookSecret: str(process.env.STRIPE_WEBHOOK_SECRET),
  stripeCurrency: (str(process.env.STRIPE_CURRENCY) ?? 'USD').toUpperCase(),
  mockCurrency: (str(process.env.MOCK_CURRENCY) ?? 'ARS').toUpperCase(),
  productPricesJson: str(process.env.PRODUCT_PRICES),

  // Fase 2
  bridgePublicUrl: str(process.env.BRIDGE_PUBLIC_URL), // wss://bridge.tudominio.com/control
  bridgeSharedSecret: str(process.env.BRIDGE_SHARED_SECRET),
  whepUrl: str(process.env.WHEP_URL), // https://stream.tudominio.com/console1/whep
  streamTokenSecret: str(process.env.STREAM_TOKEN_SECRET) ?? str(process.env.BRIDGE_SHARED_SECRET),
  streamPublishSecret: str(process.env.STREAM_PUBLISH_SECRET),
  streamPublicHls: process.env.STREAM_PUBLIC_HLS === '1',
  turnUrls: (str(process.env.TURN_URLS) ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  turnSecret: str(process.env.TURN_STATIC_AUTH_SECRET),
  consoleProfile: (str(process.env.CONSOLE_PROFILE) === 'xbox' ? 'xbox' : 'ps5') as 'ps5' | 'xbox',
};

export const supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

export function currencyFor(provider: PublicConfig['checkoutProvider']): string {
  if (provider === 'mercadopago') return env.mpCurrency;
  if (provider === 'stripe') return env.stripeCurrency;
  return env.mockCurrency;
}

/** env STREAM_MODE es el techo; /admin puede forzar SIMULATED como fallback. */
export function effectiveStreamMode(settings: Pick<AppSettings, 'stream_mode_override'> | null): StreamMode {
  if (env.streamMode !== 'REAL') return 'SIMULATED';
  return settings?.stream_mode_override === 'SIMULATED' ? 'SIMULATED' : 'REAL';
}

export function publicConfig(): PublicConfig {
  return {
    siteName: env.siteName,
    envStreamMode: env.streamMode,
    supabaseConfigured,
    checkoutProvider: env.checkoutProvider,
    currency: currencyFor(env.checkoutProvider),
  };
}

/** Diagnóstico para /admin (solo booleanos, nunca valores). */
export function configStatus() {
  return {
    supabase: supabaseConfigured,
    serviceRole: Boolean(env.supabaseServiceKey),
    checkoutProvider: env.checkoutProvider,
    mercadopago: Boolean(env.mpAccessToken),
    mercadopagoWebhookSecret: Boolean(env.mpWebhookSecret),
    stripe: Boolean(env.stripeSecretKey),
    stripeWebhookSecret: Boolean(env.stripeWebhookSecret),
    envStreamMode: env.streamMode,
    bridge: Boolean(env.bridgePublicUrl && env.bridgeSharedSecret && (env.bridgeSharedSecret?.length ?? 0) >= 32),
    whep: Boolean(env.whepUrl && env.streamTokenSecret),
    streamPublishSecret: Boolean(env.streamPublishSecret),
    turn: Boolean(env.turnUrls.length && env.turnSecret),
    appUrl: env.appUrl,
  };
}
