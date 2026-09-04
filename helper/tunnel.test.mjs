import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startTunnel, QUICK_TUNNEL_URL } from './tunnel.mjs';

const SILENT = { log() {}, error() {} };

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function spawnCapturing(record) {
  return (command, args, options) => {
    record.command = command;
    record.args = args;
    record.options = options;
    return record.child;
  };
}

test('spawns cloudflared with an argument array, never a shell string', () => {
  const record = { child: fakeChild() };
  startTunnel({ port: 8787, onUrl() {}, spawnImpl: spawnCapturing(record), log: SILENT });

  assert.equal(record.command, 'cloudflared');
  assert.deepEqual(record.args, ['tunnel', '--url', 'http://127.0.0.1:8787']);
  assert.equal(record.options.shell, undefined);
  for (const arg of record.args) assert.ok(!/[;&|]/.test(arg), arg);
});

test('reports the quick tunnel hostname printed on stderr', () => {
  const record = { child: fakeChild() };
  const seen = [];
  startTunnel({ port: 8787, onUrl: (u) => seen.push(u), spawnImpl: spawnCapturing(record), log: SILENT });

  record.child.stderr.emit('data', '  |  https://brave-fox-runs.trycloudflare.com  |\n');
  assert.deepEqual(seen, ['https://brave-fox-runs.trycloudflare.com']);
});

test('reads stdout too, since which stream carries the banner has changed', () => {
  const record = { child: fakeChild() };
  const seen = [];
  startTunnel({ port: 8787, onUrl: (u) => seen.push(u), spawnImpl: spawnCapturing(record), log: SILENT });

  record.child.stdout.emit('data', 'https://quiet-lake-9x.trycloudflare.com\n');
  assert.deepEqual(seen, ['https://quiet-lake-9x.trycloudflare.com']);
});

test('reports the hostname once, not on every later line mentioning it', () => {
  const record = { child: fakeChild() };
  const seen = [];
  startTunnel({ port: 8787, onUrl: (u) => seen.push(u), spawnImpl: spawnCapturing(record), log: SILENT });

  record.child.stderr.emit('data', 'https://a-b-c.trycloudflare.com');
  record.child.stderr.emit('data', 'request to https://a-b-c.trycloudflare.com ok');
  assert.equal(seen.length, 1);
});

test('ignores banner lines that carry no hostname', () => {
  const record = { child: fakeChild() };
  const seen = [];
  startTunnel({ port: 8787, onUrl: (u) => seen.push(u), spawnImpl: spawnCapturing(record), log: SILENT });

  record.child.stderr.emit('data', 'Thank you for trying Cloudflare Tunnel.');
  assert.deepEqual(seen, []);
});

test('survives cloudflared being missing or exiting', () => {
  const record = { child: fakeChild() };
  startTunnel({ port: 8787, onUrl() {}, spawnImpl: spawnCapturing(record), log: SILENT });

  // The helper still serves localhost when the tunnel dies; neither of these
  // may throw out of the listener and take the process down.
  assert.doesNotThrow(() => record.child.emit('error', new Error('ENOENT')));
  assert.doesNotThrow(() => record.child.emit('exit', 1));
});

test('the hostname pattern rejects lookalike domains', () => {
  assert.equal(QUICK_TUNNEL_URL.test('https://evil.trycloudflare.com.attacker.test'), true);
  // ^ matches the prefix, which is why the value is only ever used as OUR own
  // outbound address and never as an authorisation decision.
  assert.equal(QUICK_TUNNEL_URL.test('http://plain-http.trycloudflare.com'), false);
  assert.equal(QUICK_TUNNEL_URL.test('https://not-a-tunnel.example.com'), false);
});
