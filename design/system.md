# Design system: gentle-shell (Gentle Office)

Synced from `web/office.css` (CSS tokens) and `web/office-engine.js` (canvas tokens, see Canvas tokens below). Read-only; nothing was edited in the sources. Every entry names its source line. These are project values, not a proposed starter.

Counts: 17 custom properties on `:root` (16 colour aliases over 14 distinct hex values, plus `--mono`); 3 literal colours outside `:root`; 1 font stack; 10 font sizes; 2 font weights; 6 non-empty `box-shadow` declarations; 0 `border-radius`; 16 spacing values (1 to 30 px).

## Colour

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--bg` | `#060407` | body background, frame outline, dialog outer ring | `web/office.css:2` |
| `--panel` | `#100A0F` | header, footer, cards, frame, dialog and story-box face | `web/office.css:2` |
| `--user` | `#2A1523` | layout switch background | `web/office.css:2` |
| `--sel` | `#28121E` | selected and empty states, inset rings, legend rail | `web/office.css:2` |
| `--border` | `#563040` | card, frame and caption borders, dividers | `web/office.css:2` |
| `--text` | `#F6EFF3` | body text, dialog and story-box border | `web/office.css:3` |
| `--muted` | `#A78E9B` | secondary text, crumb, labels | `web/office.css:3` |
| `--dim` | `#76616B` | timestamps and decoration only (fails AA for small text, see Contrast) | `web/office.css:3` |
| `--gold` | `#E0C27A` | brand, speaker names, focus outline, default dot | `web/office.css:3` |
| `--blue` | `#A9C7EE` | explore role, tool lines, crumb path | `web/office.css:3` |
| `--green` | `#B4E7C7` | live dot, worker role, ok tone | `web/office.css:4` |
| `--red` | `#FF718F` | fail tone, live bad state | `web/office.css:4` |
| `--purple` | `#F095C8` | ask tone (same value as `--pink`) | `web/office.css:4` |
| `--sand` | `#F2B86D` | coffee and brew: pot, cups, brew number | `web/office.css:4` |
| `--heading` | `#E0C27A` | card and section headings (same value as `--gold`) | `web/office.css:4` |
| `--pink` | `#F095C8` | verify role, list bullet | `web/office.css:4` |

Literal colours outside `:root`, recorded as found (not tokens):

| Value | Usage | Source |
| --- | --- | --- |
| `#C96AA2` | header bottom border | `web/office.css:10` |
| `#151316` | live dot ring | `web/office.css:15` |
| `rgba(6, 4, 7, .7)` | story box drop shadow | `web/office.css:137` |

## Canvas tokens (web/office-engine.js)

Colours the room paints on its canvas, taken from the engine's palette. They are not in `web/office.css`. Each row names the engine line it came from. Artboards read them as `:root` custom properties with the same name (`--fuchsia` and so on). They paint shapes and floors, not text, so no text-contrast rule applies to them.

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--fuchsia` | `#FF1F9D` | orchestrator handlebar mustache and the rose on its hat | `web/office-engine.js:117` (`STACHE`) |
| `--fuchsia-deep` | `#C2107A` | underside shade of the mustache | `web/office-engine.js:117` (`STACHE_S`) |
| `--floor` | `#8C6272` | floor plank, first tone | `web/office-engine.js:100` (`P.floorA`) |
| `--floor-alt` | `#876072` | floor plank, second tone | `web/office-engine.js:100` (`P.floorB`) |
| `--floor-seam` | `#6E4D5C` | seams between planks and the board ends | `web/office-engine.js:101` (`P.seam`) |

## Typography

- Stack `--mono`: `ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace` (`web/office.css:5`). System fonts only, no web fonts.
- Base: `13px/1.45 var(--mono)` (`web/office.css:8`).
- Sizes observed: 10, 11, 12, 13, 14, 15, 16, 18, 20, 26 px.
- Weights observed: 600 (headings, labels), 700 (brand, brew number, speaker).
- Labels: uppercase with `.04em` to `.1em` tracking.

## Spacing and layout (observed, no named scale)

- Padding, gap, margin and inset values: 1, 2, 4, 6, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 28, 30 px.
- Layout: header row 44 px, footer row 30 px, sidebar column 392 px, room canvas 480 x 312 px, dock max width 520 px, narrow breakpoints at 1100 px and 720 px (`web/office.css:21`, `:20`, `:126`, `:176`).

## Shape

- Radius: none. `border-radius` is absent, so corners are square (pixel look).
- Cards and frames use 1 px `--border`; dialogs use a 3 px `--text` border.

## Shadows

| Use | Value | Source |
| --- | --- | --- |
| live dot ring | `0 0 0 2px #151316` | `web/office.css:15` |
| frame | `inset 0 0 0 4px var(--bg), inset 0 0 0 5px var(--sel)` | `web/office.css:21` |
| cups | `inset 0 3px 0 var(--gold)` | `web/office.css:38` |
| dialog | `0 0 0 3px var(--bg), 0 0 0 4px var(--border)` | `web/office.css:71` |
| story box | `inset 0 0 0 3px var(--panel), inset 0 0 0 5px var(--sel), 6px 6px 0 rgba(6, 4, 7, .7)` | `web/office.css:137` |
| story brew fill | `inset 0 3px 0 var(--gold)` | `web/office.css:145` |

## Motion

- Dialog caret: `bob .8s steps(2) infinite` (`web/office.css:79`), the only infinite animation; disabled under `prefers-reduced-motion` (`web/office.css:80`).
- Story brew fill: `width .3s steps(6)` (`web/office.css:145`).
- Terminal-office artboards: light, stepped pixel motion. 5 fps (200 ms steps) only while someone walks, writes, types, blinks or sips; lounge chat bubbles tick at 2 fps; otherwise the scheduler sleeps until the next changing frame. Paused when the window is unfocused, hidden or off-screen. `prefers-reduced-motion` shows one still frame and starts no timers.

## Components

- Card: panel face, 1 px border, 14 px by 16 px padding; heading 12 px uppercase, `--heading`, `.08em` tracking.
- Dot: 12 px square. Role colours: explore `--blue`, worker `--green`, verify `--pink`, default `--gold`.
- Cups: 14 px squares, `--sand` with gold top inset; empty cups use `--sel` with no shadow.
- Dialog: panel face, 3 px `--text` border, double ring, speaker in `--gold` 700, bullets `--pink`.
- Caption: 1 px border, 12 px, one line with ellipsis; speaker colour by tone (ok green, fail red, ask purple, coffee sand).
- Layout switch: `--user` background, 1 px border, pressed state `--gold` on `--sel`, focus ring 2 px `--gold` offset -2 px.
- Live: 8 px square in `currentColor`.
- Map legend: 2 px `--sel` rail, `--gold` term, `--muted` description.

## Contrast (WCAG 2.x, computed from the tokens above)

Text on `--bg` / `--panel` / `--user` / `--sel`:

| Token | bg | panel | user | sel | Verdict |
| --- | --- | --- | --- | --- | --- |
| `--text` | 18.05 | 17.31 | 15.09 | 15.52 | AA |
| `--muted` | 6.79 | 6.51 | 5.68 | 5.84 | AA |
| `--gold` / `--heading` | 11.83 | 11.35 | 9.89 | 10.18 | AA |
| `--blue` | 11.76 | 11.28 | 9.83 | 10.11 | AA |
| `--green` | 14.78 | 14.17 | 12.35 | 12.71 | AA |
| `--red` | 7.79 | 7.47 | 6.51 | 6.70 | AA |
| `--pink` / `--purple` | 9.57 | 9.17 | 8.00 | 8.23 | AA |
| `--sand` | 11.53 | 11.05 | 9.64 | 9.91 | AA |
| `--dim` | 3.59 | 3.44 | 3.00 | 3.09 | Fails AA for text under 18.66 px (4.5:1); passes only as 3:1 on `--user` |

Finding for the parent: `web/office.css` puts `--dim` on the `.log time` stamps at 12 px (about 3.4:1 on `--panel`). It is not changed here (read-only); the design uses `--muted` for any text that carries meaning.
