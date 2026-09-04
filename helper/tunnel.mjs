import { spawn } from 'node:child_process';

/**
 * Runs cloudflared and reports the address it was given.
 *
 * A Cloudflare quick tunnel picks a new hostname every time it starts, so a
 * TUNNEL_URL set by hand is correct exactly once and wrong after the next
 * reboot — which, for something meant to auto-start, means it is usually
 * wrong. Reading the hostname out of cloudflared's own output is what makes
 * this unattended: one thing to launch at boot, and it finds its own address.
 *
 * A hostname set explicitly in the environment still wins, so a named tunnel
 * with a stable address needs none of this.
 */

/** cloudflared announces the address in a banner; this is the only part that matters. */
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

export function startTunnel({
  port,
  onUrl,
  command = process.env.CLOUDFLARED_PATH ?? 'cloudflared',
  spawnImpl = spawn,
  log = console,
} = {}) {
  const child = spawnImpl(
    command,
    ['tunnel', '--url', `http://127.0.0.1:${port}`],
    // An argument array, never a shell string: `port` reaches this from the
    // environment, and a shell would let a crafted value become a command.
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let found = null;
  const scan = (chunk) => {
    // cloudflared prints its banner to stderr, but which stream carries it has
    // changed between releases, so both are read rather than guessed at.
    if (found !== null) return;
    const match = QUICK_TUNNEL_URL.exec(String(chunk));
    if (match === null) return;
    found = match[0];
    log.log(`Quick tunnel is at ${found}`);
    onUrl(found);
  };

  child.stdout?.on('data', scan);
  child.stderr?.on('data', scan);

  child.on('error', (error) => {
    // Missing cloudflared is not fatal: the helper still serves localhost, and
    // saying so is more use than exiting with a stack trace.
    log.error(`Could not start cloudflared (${error.message}). Set TUNNEL_URL by hand, or install cloudflared.`);
  });

  child.on('exit', (code) => {
    log.error(`cloudflared exited with code ${code}. The helper is no longer reachable from the app.`);
  });

  return child;
}

export { QUICK_TUNNEL_URL };
