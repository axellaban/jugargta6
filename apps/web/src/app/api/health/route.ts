import { env, supabaseConfigured } from '@/lib/env';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export function GET() {
  return json({ ok: true, envStreamMode: env.streamMode, supabase: supabaseConfigured, checkout: env.checkoutProvider });
}
