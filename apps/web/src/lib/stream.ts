import type { StreamProvider } from './types.ts';

export interface EmbedInfo {
  src: string | null;
  provider: StreamProvider;
  sourceUrl: string | null; // link al canal/video original (atribución)
  label: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const SLUG = /^[A-Za-z0-9_]{2,40}$/;

/** Extrae un id de video, un id de canal o un handle de lo que pegue el admin. */
export function parseYouTube(input: string): { videoId?: string; channelId?: string } {
  const s = input.trim();
  if (YT_ID.test(s)) return { videoId: s };
  if (YT_CHANNEL.test(s)) return { channelId: s };
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = url.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1, 12);
      return YT_ID.test(id) ? { videoId: id } : {};
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v && YT_ID.test(v)) return { videoId: v };
      const parts = url.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'shorts') && parts[1] && YT_ID.test(parts[1])) {
        return { videoId: parts[1] };
      }
      if (parts[0] === 'channel' && parts[1] && YT_CHANNEL.test(parts[1])) return { channelId: parts[1] };
      const ch = url.searchParams.get('channel');
      if (ch && YT_CHANNEL.test(ch)) return { channelId: ch };
    }
  } catch {
    // no es URL
  }
  return {};
}

export function parseSlug(input: string, host: string): string | null {
  const s = input.trim();
  if (SLUG.test(s)) return s;
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    if (!url.hostname.endsWith(host)) return null;
    const first = url.pathname.split('/').filter(Boolean)[0] ?? url.searchParams.get('channel') ?? '';
    return SLUG.test(first) ? first : null;
  } catch {
    return null;
  }
}

/**
 * URL del reproductor embebido. Se usa el reproductor oficial del proveedor, sin taparlo ni
 * modificarlo (lo exigen los términos de YouTube, Kick y Twitch).
 */
export function buildEmbed(provider: StreamProvider, source: string, parentHost = 'localhost'): EmbedInfo {
  if (provider === 'youtube') {
    const { videoId, channelId } = parseYouTube(source);
    if (videoId) {
      return {
        provider,
        src: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`,
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        label: 'YouTube',
      };
    }
    if (channelId) {
      return {
        provider,
        src: `https://www.youtube.com/embed/live_stream?channel=${channelId}&autoplay=1&mute=1&playsinline=1`,
        sourceUrl: `https://www.youtube.com/channel/${channelId}/live`,
        label: 'YouTube',
      };
    }
  }
  if (provider === 'kick') {
    const slug = parseSlug(source, 'kick.com');
    if (slug) {
      return {
        provider,
        src: `https://player.kick.com/${slug}?autoplay=true&muted=true`,
        sourceUrl: `https://kick.com/${slug}`,
        label: 'Kick',
      };
    }
  }
  if (provider === 'twitch') {
    const slug = parseSlug(source, 'twitch.tv');
    if (slug) {
      return {
        provider,
        src: `https://player.twitch.tv/?channel=${slug}&parent=${encodeURIComponent(parentHost)}&autoplay=true&muted=true`,
        sourceUrl: `https://www.twitch.tv/${slug}`,
        label: 'Twitch',
      };
    }
  }
  return { provider, src: null, sourceUrl: null, label: '' };
}
