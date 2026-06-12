import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Point the library at temp files BEFORE importing it (paths bind at import).
const DIR = mkdtempSync(join(tmpdir(), 'ccsb-test-'));
process.env.CC_STATUS_BUTTONS_REGISTRY = join(DIR, 'registry.json');
process.env.CC_STATUS_BUTTONS_STATE = join(DIR, 'state.json');

const { ensureRegistry, upsertButtons, readRegistry } = await import('../src/registry.mjs');
const { renderButtons, pressUrl } = await import('../src/render.mjs');
const { detectTransport } = await import('../src/detect.mjs');
const { dispatch } = await import('../src/dispatch.mjs');
const { readState } = await import('../src/state.mjs');

const BUS = fileURLToPath(new URL('../src/bus.mjs', import.meta.url));
const HOOK = fileURLToPath(new URL('../adapters/prompt-hook.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

test.after(() => rmSync(DIR, { recursive: true, force: true }));

function markerButton(id, markerPath, sentinel = null) {
  return {
    id,
    icon: '▶',
    sentinel,
    command: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'hit')`],
  };
}

async function waitFor(predicate, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return predicate();
}

test('registry: ensureRegistry creates port, token, and empty maps', () => {
  const reg = ensureRegistry();
  assert.equal(reg.port, 41999);
  assert.match(reg.token, /^[0-9a-f]{32}$/);
  assert.deepEqual(reg.buttons, {});
});

test('registry: upsert is idempotent and validates input', () => {
  const a = upsertButtons([{ id: 'next', icon: '▶', command: ['node', 'x.mjs'], sentinel: '>>' }]);
  const tokenBefore = a.token;
  const b = upsertButtons([{ id: 'next', icon: '▶', command: ['node', 'x.mjs'], sentinel: '>>' }]);
  assert.equal(b.token, tokenBefore);
  assert.deepEqual(b.buttons.next, { icon: '▶', command: ['node', 'x.mjs'], sentinel: '>>' });
  assert.throws(() => upsertButtons([{ id: 'bad id!' }]));
  assert.throws(() => upsertButtons([{ id: 'shelly', command: 'rm -rf /' }]));
});

test('render: press URLs carry the token per transport', () => {
  const reg = readRegistry();
  assert.equal(pressUrl(reg, 'http', 'next'), `http://127.0.0.1:${reg.port}/press/next?t=${reg.token}`);
  assert.equal(pressUrl(reg, 'scheme', 'next'), `ccbtn://press/next?t=${reg.token}`);
  assert.ok(pressUrl(reg, 'vscode', 'next').startsWith('vscode://noam-bash.cc-status-buttons/press/next?t='));
});

test('render: pressed button is bold, others dim, links wrap icons', () => {
  const reg = readRegistry();
  const defs = [
    { id: 'a', icon: '▶' },
    { id: 'b', icon: '⏸' },
  ];
  const out = renderButtons(reg, defs, { transport: 'http', pressedId: 'a' });
  assert.ok(out.includes('\x1b[1m▶'));
  assert.ok(out.includes('\x1b[2m⏸'));
  assert.ok(out.includes('/press/a?t='));
  const plain = renderButtons(reg, defs, { links: false });
  assert.ok(!plain.includes('\x1b]8;;'));
});

test('detect: environment matrix', () => {
  const off = { transports: {} };
  const on = { transports: { scheme: true, vscode: true } };
  assert.equal(detectTransport(off, { CC_STATUS_BUTTONS_TRANSPORT: 'prompt' }, 'linux'), 'prompt');
  assert.equal(detectTransport(on, { TERM_PROGRAM: 'vscode' }, 'win32'), 'vscode');
  assert.equal(detectTransport(off, { TERM_PROGRAM: 'vscode' }, 'win32'), 'http');
  assert.equal(detectTransport(on, { WEZTERM_EXECUTABLE: '/usr/bin/wezterm' }, 'linux'), 'scheme');
  assert.equal(detectTransport(on, { WT_SESSION: 'x' }, 'win32'), 'http');
  assert.equal(detectTransport(on, {}, 'darwin'), 'scheme');
  assert.equal(detectTransport(off, {}, 'linux'), 'http');
});

test('dispatch: runs the command and records pressed state', async () => {
  const marker = join(DIR, 'dispatch-marker.txt');
  const reg = upsertButtons([markerButton('hit-me', marker)]);
  assert.equal(dispatch(reg, 'hit-me'), true);
  assert.equal(dispatch(reg, 'nope'), false);
  assert.equal(readState().pressed.id, 'hit-me');
  assert.ok(await waitFor(() => existsSync(marker)), 'command did not run');
});

test('integration: bus presses with valid token only', async (t) => {
  const marker = join(DIR, 'bus-marker.txt');
  const reg = upsertButtons([markerButton('bus-btn', marker)]);
  const port = 42123;

  const child = spawn(process.execPath, [BUS, String(port)], { env: process.env, stdio: 'ignore' });
  t.after(() => child.kill());

  let alive = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !alive) {
    try {
      alive = (await fetch(`http://127.0.0.1:${port}/ping`)).status === 204;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert.ok(alive, 'bus did not start within 5s');

  const noToken = await fetch(`http://127.0.0.1:${port}/press/bus-btn`);
  assert.equal(noToken.status, 403);
  assert.ok(!existsSync(marker));

  const badId = await fetch(`http://127.0.0.1:${port}/press/ghost?t=${reg.token}`);
  assert.equal(badId.status, 404);

  const ok = await fetch(`http://127.0.0.1:${port}/press/bus-btn?t=${reg.token}`);
  assert.equal(ok.status, 204);
  assert.ok(await waitFor(() => existsSync(marker)), 'bus press did not run command');

  const page = await fetch(`http://127.0.0.1:${port}/press/bus-btn?t=${reg.token}&r=page`);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('window.close'));
});

test('integration: prompt hook presses sentinels and ignores other prompts', async () => {
  const marker = join(DIR, 'hook-marker.txt');
  upsertButtons([markerButton('hook-btn', marker, '%%')]);

  const hit = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt: ' %% ' }),
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(hit.status, 0, hit.stderr);
  assert.equal(JSON.parse(hit.stdout).decision, 'block');
  assert.ok(await waitFor(() => existsSync(marker)), 'hook press did not run command');

  const normal = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt: 'hello >> there' }),
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(normal.stdout.trim(), '');
});

test('integration: cli press works without a token (local file access)', async () => {
  const marker = join(DIR, 'cli-marker.txt');
  upsertButtons([markerButton('cli-btn', marker)]);
  const res = spawnSync(process.execPath, [CLI, 'press', 'cli-btn'], { env: process.env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(await waitFor(() => existsSync(marker)));
});

test('scheme handler: validates scheme, token, and id', async () => {
  const marker = join(DIR, 'scheme-marker.txt');
  const reg = upsertButtons([markerButton('scheme-btn', marker)]);
  const HANDLER = fileURLToPath(new URL('../adapters/scheme/handler.mjs', import.meta.url));

  const bad = spawnSync(process.execPath, [HANDLER, `ccbtn://press/scheme-btn?t=wrong`], { env: process.env });
  assert.equal(bad.status, 1);
  assert.ok(!existsSync(marker));

  const ok = spawnSync(process.execPath, [HANDLER, `ccbtn://press/scheme-btn?t=${reg.token}`], { env: process.env });
  assert.equal(ok.status, 0);
  assert.ok(await waitFor(() => existsSync(marker)));
});
