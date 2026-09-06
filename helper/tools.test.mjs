import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTool, TOOL_NAMES } from './tools.mjs';

const WIN = 'win32';

/** A fake filesystem: only the listed paths exist. */
function fakeFs(paths, dirs = {}) {
  return {
    exists: (p) => paths.includes(p),
    readDir: (d) => dirs[d] ?? [],
  };
}

test('an explicit override wins over everything else', () => {
  const found = resolveTool('cloudflared', {
    env: { CLOUDFLARED_PATH: 'D:\\custom\\cf.exe', PATH: 'C:\\bin' },
    platform: WIN,
    ...fakeFs(['C:\\bin\\cloudflared.exe', 'D:\\custom\\cf.exe']),
  });
  assert.equal(found, 'D:\\custom\\cf.exe');
});

test('an override is trusted even when the file is not there yet', () => {
  // The operator said where it lives; refusing would be second-guessing them,
  // and spawn reports a missing binary perfectly well on its own.
  const found = resolveTool('yt-dlp', {
    env: { YTDLP_PATH: 'D:\\later\\yt-dlp.exe' },
    platform: WIN,
    ...fakeFs([]),
  });
  assert.equal(found, 'D:\\later\\yt-dlp.exe');
});

test('PATH is used when it actually contains the tool', () => {
  const found = resolveTool('cloudflared', {
    env: { PATH: 'C:\\other;C:\\bin' },
    platform: WIN,
    ...fakeFs(['C:\\bin\\cloudflared.exe']),
  });
  assert.equal(found, 'C:\\bin\\cloudflared.exe');
});

test('THE BUG: a known install location is found when PATH has gone stale', () => {
  // The observed failure. winget installed cloudflared and added it to the
  // registry PATH, but every already-running shell still carries the
  // environment block it was born with, so the PATH lookup above finds nothing.
  const found = resolveTool('cloudflared', {
    env: { PATH: 'C:\\windows;C:\\windows\\system32' },
    platform: WIN,
    ...fakeFs(['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe']),
  });
  assert.equal(found, 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe');
});

test('THE BUG, second half: yt-dlp is found in its winget package directory', () => {
  const packages = 'C:\\Users\\Me\\AppData\\Local\\Microsoft\\WinGet\\Packages';
  const pkg = 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe';
  const found = resolveTool('yt-dlp', {
    env: { PATH: 'C:\\windows', LOCALAPPDATA: 'C:\\Users\\Me\\AppData\\Local' },
    platform: WIN,
    ...fakeFs([`${packages}\\${pkg}\\yt-dlp.exe`], { [packages]: ['DenoLand.Deno_x', pkg] }),
  });
  assert.equal(found, `${packages}\\${pkg}\\yt-dlp.exe`);
});

test('a package that buries the binary one level down is still found', () => {
  const packages = 'C:\\L\\Microsoft\\WinGet\\Packages';
  const pkg = 'yt-dlp.yt-dlp_hash';
  const found = resolveTool('yt-dlp', {
    env: { PATH: '', LOCALAPPDATA: 'C:\\L' },
    platform: WIN,
    ...fakeFs(
      [`${packages}\\${pkg}\\inner\\bin\\yt-dlp.exe`],
      { [packages]: [pkg], [`${packages}\\${pkg}`]: ['inner'] },
    ),
  });
  assert.equal(found, `${packages}\\${pkg}\\inner\\bin\\yt-dlp.exe`);
});

test('falls back to the bare name so the friendly ENOENT message survives', () => {
  const found = resolveTool('cloudflared', {
    env: { PATH: 'C:\\windows' },
    platform: WIN,
    ...fakeFs([]),
  });
  assert.equal(found, 'cloudflared');
});

test('does not append .exe off Windows', () => {
  const found = resolveTool('yt-dlp', {
    env: { PATH: '/usr/local/bin' },
    platform: 'linux',
    ...fakeFs(['/usr/local/bin/yt-dlp']),
  });
  assert.equal(found, '/usr/local/bin/yt-dlp');
});

test('Windows install locations are not consulted off Windows', () => {
  // A Linux box has no Program Files, and probing for one would only produce
  // confusing paths in an error message.
  const found = resolveTool('cloudflared', {
    env: { PATH: '/nowhere', LOCALAPPDATA: '/tmp' },
    platform: 'linux',
    ...fakeFs(['C:\\Program Files\\cloudflared\\cloudflared.exe']),
  });
  assert.equal(found, 'cloudflared');
});

test('an unknown tool name is refused rather than guessed at', () => {
  assert.throws(() => resolveTool('rm', { env: {}, platform: WIN, ...fakeFs([]) }));
});

test('both tools the helper needs are covered', () => {
  assert.deepEqual([...TOOL_NAMES].sort(), ['cloudflared', 'yt-dlp']);
});
