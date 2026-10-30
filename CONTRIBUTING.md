# Contributing to Gentle Office

Thanks for helping. This guide covers how to run the project and what a good pull request looks like.

## Setup

```bash
git clone https://github.com/maiconcrespo/gentle-reef
cd gentle-reef
npm test            # Node's built-in runner with TypeScript type stripping; no install needed
pi install ./       # load your checkout into Pi
```

Node.js 22.18 or newer is required. There are no runtime dependencies: Pi's packages are peer dependencies.

## How the code fits together

```text
Pi events ──> src/adapter (pure) ──> OfficeHub ──> src/server (loopback SSE) ──> web/
                    │                                                           ├─ scene-reducer.js  pure state + narrator (tested from node)
              src/contract (OfficeEvent v1)                                     ├─ office-engine.js  canvas engine and sprites
                                                                                └─ app.js            stream -> reducer -> engine
```

- Keep `src/contract`, `src/adapter` and `web/scene-reducer.js` pure. Put logic there so it can be tested.
- `web/` is served from a fixed allowlist, with no CDNs or external fonts. A new file under `web/` must also be added to the allowlist in `src/server/office-server.ts`.
- The server is local-only on purpose: `127.0.0.1`, a random token, a Host check, GET only, and a strict CSP. Pull requests that loosen these guards need a clear reason and tests.
- See [docs/reference.md](docs/reference.md) for the full behavior.

## Good first contributions

- **Terminal stage (T7).** Build the design in `design/terminal-office/02-stage-over-chat.html` inside the Pi TUI, using `@earendil-works/pi-tui` (`Image`, Kitty graphics).
- **Sprites and props.** New props for gentle-shell features, or better animation frames in `web/office-engine.js`.
- **Narration lines** in `web/scene-reducer.js`, with tests in `test/narrator.test.ts`.

The planning history of every feature lives in `odd/tasks/gentle-office.md`. Read it before you change existing behavior.

## Pull requests

- Open an issue first for anything bigger than a small fix.
- Test first: add a failing test, make it pass, then refactor. `npm test` must pass.
- For visual changes, attach a screenshot or a short GIF.
- Keep pull requests small (about 400 changed lines), and update the docs alongside the behavior.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(office): ...`, `fix(office): ...`, `docs: ...`.
