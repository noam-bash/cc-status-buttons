# cc-status-buttons

**Clickable buttons for the Claude Code status line.** One declarative API; the click is delivered by the best transport available in your environment — silent where possible, universal everywhere else.

```
● NVDA $204.87 ▲2.22% ▂▃▅▆▇  [▶] [⏸] [⟳]   │  Opus · 34% ctx
```

The Claude Code status line is one-way: JSON in, text out. The only user gesture a terminal grants that text is "open this URL" (OSC 8 hyperlinks). This library turns that single affordance into buttons by routing clicks through per-environment **transport adapters** to a token-gated local dispatcher.

## Quickstart

In your statusline script:

```js
import { statusButtons } from 'cc-status-buttons';

const bar = await statusButtons([
  { id: 'next',  icon: '▶', command: ['node', '/abs/path/next.mjs'], sentinel: '>>' },
  { id: 'pause', icon: '⏸', command: ['node', '/abs/path/pause.mjs'] },
]);

console.log(`my segment ${bar.render()}`);
```

`statusButtons()` upserts the definitions into the shared registry (`~/.claude/status-buttons.json`), picks a transport, starts the bus if needed, and `render()` returns OSC 8 text. A recently pressed button renders bold for ~1.5s as feedback.

## Transports

| Environment | Transport | Click feel |
|---|---|---|
| **tmux (any terminal)** | **click in tmux's status bar → `run-shell`** | **Silent, instant, truly direct** |
| WezTerm / kitty | `ccbtn://` via `open-uri` / `open_actions` | Silent, instant |
| macOS terminals | `ccbtn://` via registered app handler | Silent, instant |
| Linux desktop terminals | `ccbtn://` via `.desktop` handler (emulator-dependent) | Silent where supported |
| VS Code / Cursor terminal | `vscode://` into the companion extension | Silent, instant |
| Windows Terminal | `http://127.0.0.1` → button bus | Browser tab flash |
| Keyboard (anywhere) | type the button's sentinel (e.g. `>>`) as a prompt | Silent, instant |

Detection is automatic (`TMUX`, `TERM_PROGRAM`, `WEZTERM_EXECUTABLE`, `KITTY_WINDOW_ID`, `WT_SESSION`, platform) and respects which transports are actually registered on the machine. Force one with `CC_STATUS_BUTTONS_TRANSPORT=tmux|http|scheme|vscode|none`.

### Why this exists

Claude Code's own status line is one-way (JSON in, text out) and its keybindings are a closed action set with no "run command" action, so a button rendered *in Claude Code's status line* can only ever hand a URL to the OS — hence the browser/daemon transports. The one place you can have a genuinely **direct** clickable status-line button is **tmux**, which owns both the rendering and the mouse events of its own status bar and can bind a click to a shell command.

### The tmux transport (recommended on Linux/macOS/WSL)

Run Claude Code inside tmux, then:

```
cc-status-buttons tmux-setup     # enable mouse, add buttons to status-right, bind the click
cc-status-buttons tmux-teardown  # undo
```

This renders each button into tmux's `status-right` wrapped in a clickable range (`#[range=user|<token>]<icon>#[norange]`) and binds `MouseDown1Status` so a click on a button fires `run-shell` → the button's command — **no browser, no daemon, no token, no http**. Clicks elsewhere on the status line keep their default behaviour. The button lives in tmux's status row (just below Claude Code's status line); requires tmux 3.3+ for clickable ranges. Re-run `tmux-setup` after changing your buttons.

### The button bus (http transport)

A single shared localhost daemon serves **all** registered buttons: `GET /press/<id>?t=<token>`. It is spawned on demand by `render()`, binds to 127.0.0.1 only, exits when idle for 6 hours, and a second copy exits immediately if the port is taken. Append `&r=page` for a self-closing page response instead of `204 No Content`.

### The scheme transport

```
npx cc-status-buttons register-scheme
```

Registers `ccbtn://` for your OS (Linux: `.desktop` + `xdg-mime`; macOS: a tiny generated app bundle). For WezTerm/kitty the command prints the config snippet — their `open-uri` hooks run the handler directly with **no browser involved**, which is the smoothest click available anywhere. Windows Terminal does not open custom schemes; Windows stays on http.

### The prompt transport

Wire `adapters/prompt-hook.mjs` as a `UserPromptSubmit` hook (plugins can ship it via `hooks/hooks.json`). Typing a button's `sentinel` as a prompt presses the button and blocks the prompt — zero tokens spent, zero windows opened.

### The VS Code transport

Install `vscode-extension/cc-status-buttons-0.1.0.vsix` (`code --install-extension …`). The extension registers a URI handler, flags the transport in the registry, and clicks inside VS Code/Cursor terminals dispatch silently with a status-bar toast.

## Security

Browser JavaScript on any webpage can `fetch("http://127.0.0.1:…")` — so every press URL carries a per-install random token, and the bus rejects requests without it (403). Commands are stored in exec form (`["node", "script.mjs"]`) and spawned without a shell, so registry contents never reach a shell parser. The CLI (`npx cc-status-buttons press <id>`) skips the token because local file access already implies more power.

## Latency model

A press dispatches immediately; the *visible* result appears on the next status line render. Set `"refreshInterval": 1` in your statusline settings for sub-second feedback, and rely on the pressed-bold state to acknowledge the click.

## CLI

```
npx cc-status-buttons status              # registry, detected transport, bus liveness
npx cc-status-buttons press <id>          # press from the shell
npx cc-status-buttons bus                 # run the bus in the foreground
npx cc-status-buttons register-scheme     # set up ccbtn:// for this OS
npx cc-status-buttons tmux-setup          # wire clickable buttons into tmux's status bar
npx cc-status-buttons tmux-teardown       # remove the tmux wiring
```

## Tests

```
node --test
```

## Status

Early but functional: tmux/http/prompt/scheme/vscode transports implemented, 13 integration-heavy tests. The tmux transport is verified end-to-end on tmux 3.4. First consumer: [claude-stock-ticker](https://github.com/noam-bash/claude-stock-ticker) (rotating symbol button). macOS scheme registration and the VS Code extension's click hop are implemented but not yet exercised on real hardware.
