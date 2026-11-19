import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmbed, parseYouTube } from './stream.ts';

test('parseYouTube acepta ids, urls y canales', () => {
  assert.deepEqual(parseYouTube('dQw4w9WgXcQ'), { videoId: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), { videoId: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTube('https://youtu.be/dQw4w9WgXcQ'), { videoId: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTube('youtube.com/live/dQw4w9WgXcQ?si=x'), { videoId: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTube('UCabcdefghijklmnopqrstuv'), { channelId: 'UCabcdefghijklmnopqrstuv' });
  assert.deepEqual(parseYouTube('https://evil.com/watch?v=dQw4w9WgXcQ'), {});
});

test('buildEmbed por proveedor', () => {
  assert.match(buildEmbed('youtube', 'dQw4w9WgXcQ').src!, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(buildEmbed('youtube', 'UCabcdefghijklmnopqrstuv').src!, /live_stream\?channel=UCabc/);
  assert.equal(buildEmbed('kick', 'https://kick.com/canal_1').src, 'https://player.kick.com/canal_1?autoplay=true&muted=true');
  assert.match(buildEmbed('twitch', 'canal', 'mi.app').src!, /parent=mi\.app/);
  assert.equal(buildEmbed('kick', 'https://twitch.tv/x').src, null);
  assert.equal(buildEmbed('youtube', '<script>').src, null);
  assert.equal(buildEmbed('none', 'x').src, null);
});
