import { env } from '@/lib/env';
import { json, readJson, requireUser } from '@/lib/http';
import { signToken } from '@/lib/signed-token';

export const dynamic = 'force-dynamic';

/** Kill-switch: termina el turno actual en la base y corta la conexión del bridge. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const body = await readJson<{ reason: string }>(req);
  const { data, error } = await auth.supabase.rpc('admin_kick_current', {
    p_reason: typeof body.reason === 'string' && body.reason ? body.reason.slice(0, 120) : 'kicked_by_admin',
  });
  if (error) return json({ error: error.message }, error.message.includes('forbidden') ? 403 : 500);

  let bridge: 'skipped' | 'ok' | 'error' = 'skipped';
  const turn = (data as { kicked_entry_id: number | null } | null)?.kicked_entry_id;
  if (turn && env.bridgePublicUrl && env.bridgeSharedSecret) {
    try {
      const base = new URL(env.bridgePublicUrl);
      base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
      base.pathname = '/kick';
      base.search = `?turn=${turn}`;
      const now = Math.floor(Date.now() / 1000);
      const tok = signToken({ sub: auth.user.id, turn, aud: 'bridge-admin', iat: now, exp: now + 30 }, env.bridgeSharedSecret);
      const res = await fetch(base, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(4000) });
      bridge = res.ok ? 'ok' : 'error';
    } catch {
      bridge = 'error';
    }
  }
  return json({ ...((data as object) ?? {}), bridge });
}
