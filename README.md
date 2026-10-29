# Gentle Office

A pixel-art office that shows real gentle-shell activity: the orchestrator, subagents, and tokens as a coffee pot. It ships as a standalone Pi package from this repo.

**Status (T3):** event contract, adapter, hub, toggle, `/office` command, and the browser window. The window shows the orchestrator, the coffee pot, and resident subagents (explore, worker, verify) at the four desks; extra agents wait on a bench by the door.

## Install

From a checkout:

```bash
pi install ./
```

Or add the path to the `packages` list in your Pi `settings.json`.

## Use

```text
/office          # open a menu: turn on/off, open the window, or show status
/office on       # attach listeners
/office open     # start the window (once per session) and open it in the browser
/office off      # detach listeners, close the window, clear the hub
/office status   # enabled state, hub stats, and the window URL while it runs
```

The module is off by default. When it is off, the only thing registered is the `/office` command, and `/office open` refuses until you run `/office on`.

## The window

`/office open` starts a loopback server on `127.0.0.1` with a random port and prints the URL. The URL carries a random token in its path, so only the page you were given can read it. The page shows:

- the orchestrator at the whiteboard while it thinks or runs a tool, walking the floor while idle, and at the front with a `?` bubble when it waits for you;
- resident subagents (explore, worker, verify, and unknown agents as generic workers) at the desks: they walk in, type while running, show `?` while waiting, and leave through the door with `✓` or `!` when they finish. Inspectors and judges are only logged until T4 and T5;
- a story-mode dialog box with the question and its options while an `ask_user` prompt is open. It is display only: you still answer in the terminal, and it closes when the prompt ends;
- the coffee pot: it drains as context fills (level = 1 - percent/100), and compaction walks the orchestrator to the coffee machine to brew a fresh one;
- an activity log with tool and compaction lines;
- a connection indicator (`live`, `reconnecting…`, or `offline`). The page reconnects by itself and resyncs from a fresh snapshot.

With `prefers-reduced-motion` set, the orchestrator does not wander and residents snap to their seats and to the door. State changes still show.

### Local-only guards

- Binds `127.0.0.1` only, on a random port.
- Every route lives under a per-instance random token. A wrong or missing token gets 404.
- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`. Anything else gets 403 (DNS rebinding guard).
- GET only. The window takes no input; the boss input channel arrives in T8 with its own auth.
- No CORS headers. A Content-Security-Policy allows only same-origin scripts, styles, and the event stream.
- Only the files in `web/` are served, from a fixed allowlist. No external URLs, CDNs, or fonts.

## Settings

`<agentDir>/gentle-office.json`:

```json
{ "enabled": false }
```

A missing or invalid file means disabled. Only an explicit `"enabled": true` turns the module on.

## Layout

- `src/contract/`: the normalized `OfficeEvent` contract (versioned, `v: 1`), role and feature mapping, and the inbound `boss.input` validator. Pure.
- `src/adapter/`: maps Pi events and gentle-pi task status to contract events, plus the in-memory `OfficeHub`. Pure.
- `src/server/`: the loopback window server (`office-server.ts`) and the platform browser opener (`open-browser.ts`).
- `src/settings.ts`, `src/toggle.ts`: settings file and the on/off controller.
- `web/`: the page. `scene-reducer.js` is pure and tested from node; `office-engine.js` is the 32-bit canvas engine from `design/agent-office/01-overworld-hq.html`; `app.js` connects the stream to both.
- `extensions/gentle-office.ts`: thin Pi wiring.
- `test/`: `npm test` runs the suite with Node's built-in test runner and TypeScript type stripping. No dependencies to install.
