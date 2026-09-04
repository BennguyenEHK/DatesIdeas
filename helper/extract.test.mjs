import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYtDlpArgs, chooseLyrics, isAllowedYouTubeUrl } from './extract.mjs';

test('isAllowedYouTubeUrl accepts the exact YouTube hosts and URL shapes', () => {
  for (const url of [
    'https://youtube.com/watch?v=x', 'https://www.youtube.com/watch?v=x',
    'https://m.youtube.com/watch?v=x', 'https://music.youtube.com/watch?v=x',
    'https://youtu.be/x', 'https://www.youtube.com/shorts/x',
  ]) assert.equal(isAllowedYouTubeUrl(url), true, url);
});

test('isAllowedYouTubeUrl rejects lookalikes and non-URLs', () => {
  for (const url of [
    'https://youtube.com.evil.test/watch?v=x', 'https://notyoutube.com',
    'http://evil/?x=youtube.com', 'youtube.com/watch?v=x', '', 'javascript:alert(1)',
  ]) assert.equal(isAllowedYouTubeUrl(url), false, url);
});

test('buildYtDlpArgs returns isolated arguments with format and duration filter', () => {
  const url = 'https://youtu.be/example?x=a;whoami';
  const args = buildYtDlpArgs(url, 'C:/temp/example');
  assert.ok(Array.isArray(args));
  assert.ok(args.includes(url));
  assert.ok(args.includes('bestaudio[ext=m4a]/bestaudio'));
  assert.ok(args.some((value) => value.startsWith('duration <= ')));
  assert.ok(args.every((value) => !value.includes('yt-dlp ') && !value.includes(' && ') && !value.includes(' | ')));
});

test('chooseLyrics returns synced lyrics from the closest duration', () => {
  const result = chooseLyrics([
    { duration: 190, syncedLyrics: '[00:00.00]far' },
    { duration: 181, syncedLyrics: '[00:00.00]near' },
    { duration: 180, plainLyrics: 'plain only' },
  ], 180);
  assert.equal(result, '[00:00.00]near');
});

test('chooseLyrics rejects candidates more than three seconds away', () => {
  assert.equal(chooseLyrics([{ duration: 184, syncedLyrics: '[00:00.00]no' }], 180), null);
});

test('chooseLyrics ignores plain-only entries and malformed input', () => {
  assert.equal(chooseLyrics([{ duration: 180, plainLyrics: 'no timestamps' }], 180), null);
  assert.equal(chooseLyrics('not an array', 180), null);
  assert.equal(chooseLyrics([null, { duration: 'nope', syncedLyrics: 'x' }], Number.NaN), null);
});
