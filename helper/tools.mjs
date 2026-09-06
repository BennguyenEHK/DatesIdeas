import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Finds the executables this helper drives, without trusting PATH.
 *
 * PATH looked like the obvious answer and is the thing that actually broke.
 * Windows hands a new process a COPY of its parent's environment, taken when
 * the parent started -- so when winget appends an install directory to the
 * registry PATH, every shell already on screen keeps the block it was born
 * with. Explorer is usually the oldest of those parents, which means opening a
 * brand new window changes nothing: it inherits Explorer's stale copy too.
 * Only signing out, or a process started from a freshly composed environment,
 * picks the change up.
 *
 * That is not a quirk worth working around once and forgetting. The scheduled
 * task that starts this at boot gets its own environment as well, and a service
 * that only works if someone happened to reboot after installing is not
 * something anyone should have to reason about at eleven at night. So the tools
 * are located here, deliberately, in the order an operator would expect: what
 * they said explicitly, then PATH, then where the installers actually put
 * things.
 */

const DEFAULT_PROGRAM_FILES = 'C:\\Program Files';
const DEFAULT_PROGRAM_FILES_X86 = 'C:\\Program Files (x86)';

const TOOLS = {
  cloudflared: {
    envVar: 'CLOUDFLARED_PATH',
    programFilesDir: 'cloudflared',
    wingetPrefix: 'Cloudflare.cloudflared',
  },
  'yt-dlp': {
    envVar: 'YTDLP_PATH',
    programFilesDir: 'yt-dlp',
    wingetPrefix: 'yt-dlp.yt-dlp',
  },
};

export const TOOL_NAMES = Object.freeze(Object.keys(TOOLS));

function quietReadDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    // A directory that is not there is the normal case on a machine that
    // installed these some other way, not something worth reporting.
    return [];
  }
}

export function resolveTool(name, {
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  readDir = quietReadDir,
} = {}) {
  const spec = TOOLS[name];
  // Refused rather than guessed at: this returns something that is about to be
  // executed, so an unrecognised name must never fall through to a bare string
  // that PATH might resolve to anything at all.
  if (spec === undefined) throw new Error(`Unknown tool: ${name}`);

  const override = env[spec.envVar];
  // An override is taken at its word even when the file is not there. The
  // operator has said where it lives, and spawn already reports a missing
  // binary clearly; second-guessing them here would hide a typo behind a silent
  // fallback to some other copy.
  if (typeof override === 'string' && override.trim() !== '') return override.trim();

  const windows = platform === 'win32';
  const join = windows ? path.win32.join : path.posix.join;
  const binary = windows ? `${name}.exe` : name;

  for (const dir of String(env.PATH ?? '').split(windows ? ';' : ':')) {
    const trimmed = dir.trim();
    if (trimmed === '') continue;
    const candidate = join(trimmed, binary);
    if (exists(candidate)) return candidate;
  }

  if (windows) {
    for (const candidate of windowsCandidates(spec, binary, env, join, readDir)) {
      if (exists(candidate)) return candidate;
    }
  }

  // The bare name, so a machine whose PATH is healthy still works and a machine
  // with nothing installed still gets spawn's own ENOENT rather than a
  // confusing complaint about a path nobody chose.
  return name;
}

function* windowsCandidates(spec, binary, env, join, readDir) {
  const roots = [
    env.ProgramFiles ?? DEFAULT_PROGRAM_FILES,
    env['ProgramFiles(x86)'] ?? DEFAULT_PROGRAM_FILES_X86,
  ];
  for (const root of roots) yield join(root, spec.programFilesDir, binary);

  const localAppData = env.LOCALAPPDATA;
  if (typeof localAppData !== 'string' || localAppData === '') return;

  yield join(localAppData, 'Microsoft', 'WinGet', 'Links', binary);

  // winget unpacks into a directory whose name carries a package identifier and
  // a store hash, so the hash cannot be written down here -- the prefix is
  // matched and the rest read off the disk.
  const packages = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  for (const entry of readDir(packages)) {
    if (!entry.startsWith(spec.wingetPrefix)) continue;
    yield join(packages, entry, binary);
    // Some packages ship the executable one level down, beside its own
    // libraries, rather than at the top of the extracted folder.
    for (const nested of readDir(join(packages, entry))) {
      yield join(packages, entry, nested, binary);
      yield join(packages, entry, nested, 'bin', binary);
    }
  }
}
