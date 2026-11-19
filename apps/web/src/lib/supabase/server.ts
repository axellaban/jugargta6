import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env, supabaseConfigured } from '../env.ts';
import { DEFAULT_SETTINGS, type AppSettings } from '../types.ts';

/** Cliente con la sesión del usuario (cookies). RLS aplica. */
export async function getServerSupabase(): Promise<SupabaseClient | null> {
  if (!supabaseConfigured) return null;
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl!, env.supabaseAnonKey!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: el proxy refresca la sesión.
        }
      },
    },
  });
}

/** Cliente service_role: bypassa RLS. Solo para pagos/webhooks/credenciales. */
export function getAdminSupabase(): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseServiceKey) return null;
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loadSettings(client: SupabaseClient | null): Promise<AppSettings> {
  if (!client) return DEFAULT_SETTINGS;
  const { data } = await client.from('app_settings').select('*').eq('id', 1).maybeSingle();
  return (data as AppSettings | null) ?? DEFAULT_SETTINGS;
}

export async function getUserAndRole(client: SupabaseClient | null) {
  if (!client) return { user: null, isAdmin: false };
  const { data } = await client.auth.getUser();
  if (!data.user) return { user: null, isAdmin: false };
  const { data: isAdmin } = await client.rpc('is_admin');
  return { user: data.user, isAdmin: Boolean(isAdmin) };
}
