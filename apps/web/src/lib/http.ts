import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getServerSupabase } from './supabase/server.ts';

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function requireUser(): Promise<{ supabase: SupabaseClient; user: User } | NextResponse> {
  const supabase = await getServerSupabase();
  if (!supabase) return json({ error: 'not_configured' }, 503);
  const { data } = await supabase.auth.getUser();
  if (!data.user) return json({ error: 'not_authenticated' }, 401);
  return { supabase, user: data.user };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
