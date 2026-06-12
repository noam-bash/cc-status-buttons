// CC Status Buttons — VS Code URI transport.
//
// Receives vscode://noam-bash.cc-status-buttons/press/<id>?t=<token> clicks
// from the integrated terminal, validates the token against the shared
// registry, and dispatches the button's command. Silent: no browser, no
// focus change beyond what the click itself did.
//
// Standalone reimplementation of src/dispatch.mjs — the extension must not
// depend on the library being installed anywhere in particular.

const vscode = require('vscode');
const { readFileSync, writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { homedir, tmpdir } = require('node:os');
const { join } = require('node:path');

const REGISTRY_PATH = join(homedir(), '.claude', 'status-buttons.json');
const STATE_PATH = join(tmpdir(), 'cc-status-buttons-state.json');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function activate(context) {
  // Flag the transport as available so detect() starts emitting vscode:// links.
  const reg = readJson(REGISTRY_PATH);
  if (reg && !(reg.transports && reg.transports.vscode)) {
    reg.transports = Object.assign({}, reg.transports, {
      vscode: true,
      vscodeUri: 'vscode://noam-bash.cc-status-buttons',
    });
    try {
      writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
    } catch {
      // Registry not writable; detection just won't pick this transport.
    }
  }

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        const match = uri.path.match(/^\/press\/([\w-]+)$/);
        const token = new URLSearchParams(uri.query).get('t');
        const registry = readJson(REGISTRY_PATH);
        if (!match || !registry || !registry.token || token !== registry.token) return;
        const btn = registry.buttons && registry.buttons[match[1]];
        if (!btn) return;
        const state = readJson(STATE_PATH) || {};
        state.pressed = { id: match[1], ts: Date.now() };
        try {
          writeFileSync(STATE_PATH, JSON.stringify(state));
        } catch {}
        if (Array.isArray(btn.command) && btn.command.length) {
          try {
            spawn(btn.command[0], btn.command.slice(1), {
              detached: true,
              stdio: 'ignore',
              shell: false,
            }).unref();
          } catch {}
        }
        vscode.window.setStatusBarMessage(`${btn.icon || '•'} pressed: ${match[1]}`, 2000);
      },
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
