import { env, effectiveStreamMode } from '@/lib/env';
import { json, requireUser } from '@/lib/http';
import { signToken, turnCredentials } from '@/lib/signed-token';
import { loadSettings } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Fase 2: credenciales para el jugador con el turno activo.
 *  - bridgeToken (aud=bridge): vence en ≤ 60 s y nunca después del fin del turno. El cliente lo renueva.
 *  - streamToken (aud=stream): lectura WHEP del video de baja latencia hasta el fin del turno.
 *  - iceServers: STUN/TURN con credenciales efímeras de coturn.
 */
export async function POST() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { supabase, user } = auth;

  const settings = await loadSettings(supabase);
  if (effectiveStreamMode(settings) !== 'REAL') return json({ error: 'not_real_mode' }, 409);
  if (!env.bridgePublicUrl || !env.bridgeSharedSecret || !env.whepUrl || !env.streamTokenSecret) {
    return json({ error: 'not_configured' }, 503);
  }

  const { data: entry } = await supabase
    .from('queue_entries')
    .select('id, status, ends_at')
    .eq('user_id', user.id)
    .eq('status', 'playing')
    .maybeSingle();
  if (!entry?.ends_at) return json({ error: 'not_playing' }, 403);

  const now = Math.floor(Date.now() / 1000);
  const endsAt = Math.floor(new Date(entry.ends_at).getTime() / 1000);
  if (endsAt <= now) return json({ error: 'not_playing' }, 403);

  const bridgeExp = Math.min(now + 60, endsAt);
  const bridgeToken = signToken({ sub: user.id, turn: entry.id, aud: 'bridge', iat: now, exp: bridgeExp }, env.bridgeSharedSecret);
  const streamToken = signToken({ sub: user.id, turn: entry.id, aud: 'stream', iat: now, exp: endsAt + 30 }, env.streamTokenSecret);

  const iceServers: RTCIceServer[] = [];
  if (env.turnUrls.length) {
    const stun = env.turnUrls.filter((u) => u.startsWith('stun:'));
    const turn = env.turnUrls.filter((u) => u.startsWith('turn:') || u.startsWith('turns:'));
    if (stun.length) iceServers.push({ urls: stun });
    if (turn.length && env.turnSecret) {
      const { username, credential } = turnCredentials(user.id, env.turnSecret, Math.max(300, endsAt - now + 300));
      iceServers.push({ urls: turn, username, credential });
    }
  }

  return json({
    turn: entry.id,
    endsAt: entry.ends_at,
    bridgeUrl: env.bridgePublicUrl,
    bridgeToken,
    bridgeTokenExp: bridgeExp,
    whepUrl: env.whepUrl,
    streamToken,
    iceServers,
    profile: env.consoleProfile,
  });
}
