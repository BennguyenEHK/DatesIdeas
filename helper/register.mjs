const REGISTER_INTERVAL_MS = 10 * 60 * 1000;

export async function registerHelper({ env = process.env, fetchImpl = fetch, log = console } = {}) {
  const appUrl = env.APP_URL?.replace(/\/+$/, '');
  const tunnelUrl = env.TUNNEL_URL;
  const secret = env.HELPER_SECRET;
  if (!appUrl || !tunnelUrl || !secret) {
    log.error('Helper registration skipped: APP_URL, TUNNEL_URL, and HELPER_SECRET are required.');
    return false;
  }

  try {
    const response = await fetchImpl(`${appUrl}/api/helper`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tunnelUrl }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    log.log('Helper tunnel URL registered.');
    return true;
  } catch (error) {
    // A tunnel or app may briefly be unavailable at boot; keep retrying instead of exiting.
    log.error(`Helper registration failed; will retry: ${error.message}`);
    return false;
  }
}

export function startRegistration(options) {
  void registerHelper(options);
  const timer = setInterval(() => { void registerHelper(options); }, REGISTER_INTERVAL_MS);
  timer.unref();
  return timer;
}
