import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAYER_CLIENTS,
  buildMetadataArgs,
  buildYtDlpArgs,
  isAllowedYouTubeUrl,
  playerClients,
  run,
} from './extract.mjs';

/** Pulls the value that follows a flag, so a test never depends on arg order. */
function valueAfter(args, flag) {
  const at = args.indexOf(flag);
  return at === -1 ? null : args[at + 1];
}

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
  assert.ok(args.includes('best[ext=mp4][vcodec!=none][acodec!=none]/18/best[ext=mp4]'));
  assert.ok(args.some((value) => value.startsWith('duration <= ')));
  assert.ok(args.every((value) => !value.includes('yt-dlp ') && !value.includes(' && ') && !value.includes(' | ')));
});

test('the video format selector never requests a merge', () => {
  const format = valueAfter(buildYtDlpArgs('https://youtu.be/example', 'C:/temp/example'), '--format');
  assert.ok(format, 'no --format selector in the download command');
  assert.ok(!format.includes('+'), `format selector requires a merge: ${format}`);
});

test('THE BUG: the download asks for a player client that is allowed to serve media', () => {
  // YouTube's default `web` client hands back format URLs that answer 403 to
  // anything without a proof-of-origin token. Metadata still works, so the
  // failure looks like a broken download rather than a refused one. Naming a
  // client that is still served is the whole fix.
  const args = buildYtDlpArgs('https://youtu.be/example', 'C:/temp/example');
  const value = valueAfter(args, '--extractor-args');
  assert.ok(value, 'no --extractor-args in the download command');
  assert.match(value, /^youtube:player_client=/);
  assert.ok(value.includes('web_embedded'), `no working client in ${value}`);
});

test('THE OTHER BUG: metadata asks for a few fields, not the whole format list', () => {
  // --dump-single-json returns every format YouTube offers, which for an
  // ordinary song is over six hundred kilobytes -- ten times what run() was
  // willing to keep. The answer arrived truncated at the front, so no line
  // began with a brace and the parse failed every time, before the download
  // was ever attempted. Asking for the five fields actually used returns
  // about a hundred and fifty bytes.
  const args = buildMetadataArgs('https://youtu.be/example');
  assert.ok(!args.includes('--dump-single-json'), 'still asking for every format');
  const template = valueAfter(args, '--print');
  assert.ok(template, 'no --print template');
  assert.match(template, /^%\(\.\{[^}]+\}\)j$/, `not a JSON field subset: ${template}`);
  for (const field of ['duration', 'title']) {
    assert.ok(template.includes(field), `metadata drops ${field}, which is read later`);
  }
});

test('run keeps stdout whole rather than tailing it into nonsense', async () => {
  // The old capture kept the LAST 64KB of stdout, which is right for stderr --
  // where the diagnosis is at the bottom -- and ruinous for anything parsed as
  // a whole. A truncated JSON document is not a smaller JSON document.
  const size = 300_000;
  const { stdout } = await run(
    process.execPath,
    ['-e', `process.stdout.write('{"a":"' + 'x'.repeat(${size}) + '"}')`],
    { timeoutMs: 30_000 },
  );
  assert.equal(stdout.length, size + 8);
  assert.ok(stdout.startsWith('{"a":"'), 'the front of the document was cut off');
  assert.deepEqual(JSON.parse(stdout).a.length, size);
});

test('run refuses absurd output instead of silently keeping part of it', async () => {
  await assert.rejects(
    run(
      process.execPath,
      ['-e', "for (let i = 0; i < 400; i += 1) process.stdout.write('y'.repeat(1024));"],
      { timeoutMs: 30_000, maxStdoutBytes: 4096 },
    ),
    (error) => error.kind === 'failed' && /too much output/i.test(error.message),
  );
});

test('the metadata command asks for the same clients as the download', () => {
  // Duration decides whether a song is refused as too long, so metadata read
  // through a different client than the video is a chance for the two to
  // disagree about what they are describing.
  assert.equal(
    valueAfter(buildMetadataArgs('https://youtu.be/example'), '--extractor-args'),
    valueAfter(buildYtDlpArgs('https://youtu.be/example', 'C:/temp/example'), '--extractor-args'),
  );
});

test('the client list can be corrected without a code change', () => {
  // YouTube breaks these periodically. Waiting on a release to sing is worse
  // than an environment variable.
  assert.equal(playerClients({ YTDLP_PLAYER_CLIENTS: 'tv,ios' }), 'tv,ios');
  assert.equal(playerClients({ YTDLP_PLAYER_CLIENTS: '  mweb  ' }), 'mweb');
});

test('a blank or missing override falls back rather than asking for no client', () => {
  // An empty player_client= is not "use the default", it is a malformed
  // argument, and it would take the download down with it.
  for (const env of [{}, { YTDLP_PLAYER_CLIENTS: '' }, { YTDLP_PLAYER_CLIENTS: '   ' }]) {
    assert.equal(playerClients(env), DEFAULT_PLAYER_CLIENTS);
  }
});

test('the default list keeps fallbacks behind the working client', () => {
  // One client is a single point of failure against a service that changes
  // without notice; yt-dlp merges the formats every listed client offers.
  const clients = DEFAULT_PLAYER_CLIENTS.split(',');
  assert.ok(clients.length > 1, 'a single client is a single point of failure');
  assert.equal(clients[0], 'web_embedded');
});
