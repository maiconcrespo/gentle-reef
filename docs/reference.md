# Gentle Office reference

The full behavior of the package: modes, commands, layouts, narration, guards and code layout. For the overview, see the [README](../README.md).

## Install

From a checkout:

```bash
pi install ./
```

Or add the path to the `packages` list in your Pi `settings.json`.

## Two ways to use it

- **`gentle-reef`: terminal mode.** Starts gentle-shell with the office attached to that session: listeners run from the start, and a one-line status widget sits above the editor, `✿ gentle-reef · terminal mode · <orchestrator state> · <n> agents`. The terminal stage comes later; the widget is the placeholder until then. The launcher is `bin/gentle-reef`. It runs `gentle-shell` with `GENTLE_REEF=1` and passes its arguments through, so it needs `gentle-shell` on your PATH. To put it on your PATH from a checkout (documented here, not run by the package):

  ```bash
  ln -s $PWD/bin/gentle-reef ~/.local/bin/gentle-reef
  ```

  Any directory on your PATH works. A plain `gentle-shell` is unchanged.

- **`/office`: web window, in any session.** Start `gentle-shell` as usual, then run `/office on` and `/office open` (or `/office dock` / `/office story`). The window opens in your browser for that session only.

Each session decides for itself. Turning the office on or off never carries over to the next session, and `gentle-reef` affects only the session it starts.

## Use

```text
/office          # open a menu: turn on/off, open the window (full or compact), or show status
/office on       # attach listeners for this session
/office open     # start the window (once per session) and open it in the browser
/office dock     # same as open, in the compact layout (?layout=dock)
/office story    # same as open, in the story layout (?layout=story)
/office off      # detach listeners, close the window, clear the hub (this session)
/office status   # enabled state, hub stats, and the window URL while it runs
```

A session starts off, unless it was started with `gentle-reef`. When it is off, the only thing registered is the `/office` command, and `/office open` and `/office dock` refuse until you run `/office on`.

The menu lists the same actions as the subcommands. While the module is off: Turn on, Turn on and open the window, Turn on and open the compact window, Turn on and open in story mode, Status. While it is on: Open the window, Turn off, Open the compact window, Open in story mode, Status.

## The window

`/office open` starts a loopback server on `127.0.0.1` with a random port and prints the URL. The URL carries a random token in its path, so only the page you were given can read it. The page shows:

- the orchestrator at the whiteboard while it thinks or runs a tool, walking the floor while idle, and at the front with a `?` bubble when it waits for you;
- resident subagents (explore, worker, verify, and unknown agents as generic workers) at the desks: they walk in, type while running, show `?` while waiting, and leave through the door with `✓` or `!` when they finish. Inspectors and judges are only logged until T4 and T5;
- idle staff (S16): one per role (explore, worker, verify) waits in the lounge: explore and worker sit on the two sofas facing each other across the coffee table, verify stands by the lab door, passing a speech bubble in turn and sipping now and then. The first agent of a role that takes a desk is that staff member: it walks over from the lounge, keeps the staff look, and walks back to the lounge when it finishes (`✓` or `!`). Its role narrates the break, for example `EXPLORE: back to the coffee.`. Further agents of that role walk in from the door as before. Team and PARTY lists show the idle staff as `on break`;
- a story-mode dialog box with the question and its options while an `ask_user` prompt is open. It is display only: you still answer in the terminal, and it closes when the prompt ends;
- the orchestrator rests in its armchair while idle (a small head turn now and then, no walking); it walks to the whiteboard in its office while it thinks or runs a tool, and to the front spot above the pod when it waits for you;
- the coffee pot: it drains as context fills (level = 1 - percent/100), and compaction walks the orchestrator to the coffee machine to brew a fresh one;
- feature props that light up while their tool runs and for 4 s after it ends: a record player (music; idle for now, because gentle music emits no event the office can see), an easel (`gentle_design`), a filing cabinet (`mem_*`), a desk bell (`ask_user_*`), a corkboard (`todo`), the MCP rack (`mcp`, `codemode`), a pigeon (`web_search`, `fetch_content`, `get_search_content`) and a pinned map (codegraph);
- a narration dialog: one line per real event with a speaker (see [Narration](#narration));
- an activity log with tool and compaction lines;
- a connection indicator (`live`, `reconnecting…`, or `offline`). The page reconnects by itself and resyncs from a fresh snapshot.

With `prefers-reduced-motion` set, the orchestrator does not wander, residents snap to their seats and to the door, and the idle staff stand still with no bubbles or sips. State changes still show.

### Full layout

The default. The room sits on top, centred, at the largest whole-number scale that fits the window's width: 2x (1440 px wide) once the window is about 1525 px wide, 1x below that. Height does not limit the scale, so on a short window the page scrolls. The legend sits under the room, then the context brew, team and activity cards in a row of three (the row wraps to fewer columns on narrow windows). The ask dialog overlays the bottom of the room, at most 60% of the frame's height, so the orchestrator's front spot stays visible above it.

### Compact layout

Compact (`design/agent-office/02-dock-pane.html`) is one narrow column, 520 px at most. The room is on top at 1x (panned, see below), then the context brew, the team and the activity. The legend is left out, and the ask dialog overlays the bottom of the room and runs a little past it, so its top stays below the orchestrator's front spot.

Open the compact layout with `/office dock`, or with "Open the compact window" / "Turn on and open the compact window" in the menu. The URL gets `?layout=dock` after the token; the token, path and checks are unchanged. The header switch (Full / Compact / Story) changes layout without reloading. Its choice is saved in the browser's localStorage and written into the URL, so a reload keeps it. A `?layout=` already in the URL wins over the saved choice for that load, so `/office dock` always shows the compact layout. The room is 720 px wide, wider than this column, so the compact layout shows it at 1x through a camera that pans to follow the action (the same camera as story). Full (above) keeps whole-number scaling by width.

### Story layout

`/office story`, or "Open in story mode" / "Turn on and open in story mode" in the menu, opens the window at `?layout=story` (`design/agent-office/03-story-mode.html`). Story fills the whole window with a close-up of the room:

- **Camera.** The room is drawn at a whole-number zoom (up to 4x), so the pixels stay square. The window is the camera: it eases toward the actor that acted last and never shows past the room's edge. Orchestrator events move it to the orchestrator, a subagent event to that resident, and a feature event to its prop.
- **CONTEXT BREW** (top left): the context left as a rounded percent, with an HP-style bar. It shows "—" until Pi reports usage.
- **PARTY** (top right): the orchestrator and each resident with its state. The row the camera follows is marked with ▶.
- **Dialog** (bottom): the narration, or the `ask_user` prompt while one is open. The footer shows the key hint: Space or a click moves to the next line.

Full and compact have no camera and take the same drawing path as before.

### Narration

The dialog narrates real events, one line each, with a speaker:

- `ORCHESTRATOR: thinking…` when a turn starts; `running bash…` at a tool start; `bash done ✓ · 0.4s` or `bash failed ! · 13s` at its end; `waiting for your answer.` while an `ask_user` prompt is open; `done, back on the floor.` when the turn ends.
- Feature props say what they do, for example `ORCHESTRATOR: saving to memory…`.
- Compaction: brewing a fresh pot, the fresh pot, or a failure.
- Subagents: `scout: arrived, waiting for a desk.`, `starts typing…`, `waiting for a reply.`, then `finished ✓`, `failed !`, `cancelled !` or `timed out !`.

Subagents' internal tool calls are not visible to the window, so their lines cover only arrival, status and the end.

Lines queue and page like a game text box: the typewriter reveals each line, a finished line waits a short time (less when several lines back up), and the next one takes the box. Space or a click finishes the typewriter, or moves on. With `prefers-reduced-motion` the line shows at once. An open `ask_user` prompt takes the box, and narration waits behind it.

In story the narration is the big bottom box. In full and compact it is a one-line caption under the room, showing the current line. The narrator is pure and tested (`test/narrator.test.ts`); the page only renders what it returns.

### Local-only guards

- Binds `127.0.0.1` only, on a random port.
- Every route lives under a per-instance random token. A wrong or missing token gets 404.
- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`. Anything else gets 403 (DNS rebinding guard).
- GET only. The window takes no input; the boss input channel arrives in T8 with its own auth.
- No CORS headers. A Content-Security-Policy allows only same-origin scripts, styles, and the event stream.
- Only the files in `web/` are served, from a fixed allowlist. No external URLs, CDNs, or fonts.

## Settings

There is no settings file. `/office on`, `/office off` and the menu change the current session only and nothing is written to disk. The old `<agentDir>/gentle-office.json` is ignored, so a `"enabled": true` left in it does nothing; you can delete it by hand.

## Layout

- `src/contract/`: the normalized `OfficeEvent` contract (versioned, `v: 1`), role and feature mapping, and the inbound `boss.input` validator. Pure.
- `src/adapter/`: maps Pi events and gentle-pi task status to contract events, plus the in-memory `OfficeHub`. Pure.
- `src/server/`: the loopback window server (`office-server.ts`) and the platform browser opener (`open-browser.ts`).
- `src/toggle.ts`: the per-session on/off controller, the terminal mode switch (`GENTLE_REEF`), and the status widget.
- `bin/gentle-reef`: launcher that starts gentle-shell with `GENTLE_REEF=1`.
- `web/`: the page. `scene-reducer.js` is pure and tested from node, and holds the narrator (`narrate`, the dialog queue); `office-engine.js` is the 32-bit canvas engine from `design/agent-office/01-overworld-hq.html`, with an optional story camera (`setCamera`); `app.js` connects the stream to both. The server serves a fixed list of files, so the narrator lives in `scene-reducer.js` rather than a separate module.
- `extensions/gentle-office.ts`: thin Pi wiring.
- `test/`: `npm test` runs the suite with Node's built-in test runner and TypeScript type stripping. No dependencies to install.
