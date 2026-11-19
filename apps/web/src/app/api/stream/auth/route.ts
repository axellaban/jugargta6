import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { json, readJson } from '@/lib/http';
import { verifyToken } from '@/lib/signed-token';
import { getAdminSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PATH = 'console1';

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Hook de autenticación HTTP de MediaMTX (authMethod: http).
 * Body: { user, password, token, ip, action, path, protocol, id, query, userAgent }
 * 2xx = permitido. Opcionalmente { expireAt } cierra la sesión al terminar el turno.
 */
export async function POST(req: Request) {
  const b = await readJson<{
    user: string; password: string; token: string; action: string; path: string; protocol: string; query: string;
  }>(req);
  const token = b.token || b.password || new URLSearchParams(b.query ?? '').get('token') || '';

  if (b.action === 'publish') {
    if (b.path === PATH && env.streamPublishSecret && token && safeEqual(token, env.streamPublishSecret)) {
      return json({});
    }
    return json({ error: 'unauthorized' }, 401);
  }

  if (b.action === 'read' && b.path === PATH) {
    if (b.protocol === 'hls' && env.streamPublicHls) return json({});
    if (b.protocol === 'webrtc' && env.streamTokenSecret) {
      const payload = verifyToken(token, env.streamTokenSecret, 'stream');
      if (!payload) return json({ error: 'unauthorized' }, 401);
      const admin = getAdminSupabase();
      if (admin) {
        const { data } = await admin
          .from('queue_entries')
          .select('id')
          .eq('id', payload.turn)
          .eq('user_id', payload.sub)
          .eq('status', 'playing')
          .maybeSingle();
        if (!data) return json({ error: 'turn_not_active' }, 401);
      }
      return json({ expireAt: new Date(payload.exp * 1000).toISOString() });
    }
  }
  return json({ error: 'unauthorized' }, 401);
}
