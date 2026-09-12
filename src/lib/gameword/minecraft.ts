export function parseServerAddress(raw: string): { host: string; port: number } | null {
  const address = raw.trim();
  if (!address || /\s|:\/\//.test(address) || /[/?#@]/.test(address)) return null;

  const match = /^([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::(\d+))?$/.exec(address);
  if (!match) return null;

  const host = match[1].toLowerCase();
  if (!host || host.includes("..") || host.startsWith(".") || host.endsWith(".")) return null;

  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    const octets = host.split(".").map(Number);
    if (octets.some((octet) => octet > 255)) return null;
  }

  const port = match[2] === undefined ? 25565 : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

export function bedrockJoinUrl(name: string, host: string, port: number): string {
  return `minecraft://?addExternalServer=${encodeURIComponent(name)}|${host}:${port}`;
}

export function formatAddress(host: string, port: number): string {
  return port === 25565 ? host : `${host}:${port}`;
}
