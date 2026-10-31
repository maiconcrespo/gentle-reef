# Terminal scene life

The Gentle HQ room in the terminal shows who is doing what: a panel toggle, judges that debate, workers that rest, an orchestrator that works at its screen, and the user as the Boss.
Branch: feat/terminal-scene-life (from main 64cb43b). Issues: #3 (judges). Follows odd/tasks/terminal-stage.md (T11d is S3 here).

## Specs
- S1 — Side panel toggle: "cuando uso el alt+c el chat se oculta pero , tendria que ocultar todo el lateral inclyendo el PARTY." Agreed: alt+c hides PARTY, notices and CHAT; the room is centred in the freed width (it grows when the side panel was what limited it) and one muted key line remains.
- S2 — Judges (#3): "#3 ok , animamos durante un judgment day." Agreed: while a `jd-judge-*` agent runs, the two judges debate in turns (speech bubble with "…" one and then the other) and the gavel moves; when they finish, the gavel strikes once and they rest.
- S3 — Workers: "los workers estan todo el tiempo trabajando, mejor que la pantalla este parada con un imagen estatica de un juego cuando no hacen nada, que se levanten y tomen un cafe a veces, si llevan mucho parado." Agreed: a desk's screen moves only while that worker works; otherwise it shows a still game picture. After about 3 minutes without work a worker stands at the coffee corner with a cup; it goes back to its desk when a worker starts. The animation is off while nobody acts, so the move to the coffee shows on the next frame (no walk).
- S4 — Orchestrator: "el orchestrator que se mueva y mire la pantalla cuando toca hacer algo". Agreed: a monitor on the orchestrator's desk; while it thinks or runs a tool it stands facing the monitor; while it waits it rests behind the desk with its cane.
- S5 — The user as the Boss: "y yo YOU, el Boss de Sudadera negra con capucha, y un B fucsia en el centro. pantalones blanco corto y zapatilla blanca, un keyboard de ordenador en la mano." Placement agreed ("ok dale asi mismo"): in front of the orchestrator's desk while the orchestrator works, by the door when everything is still.

## Tasks
- T1 — S1: alt+c hides the whole side panel. Route: inline. Commit: pending.
- T2 — S2: judges debate during a judgment day, gavel strike at the end. Route: inline. Commit: pending.
- T3 — S3: worker screens and the coffee break. Route: inline. Commit: pending.
- T4 — S4: orchestrator at its monitor. Route: inline. Commit: pending.
- T5 — S5: the Boss sprite and its two places. Route: inline. Commit: pending.
- T6 — S1-S5: README and docs/reference.md. Route: inline. Commit: pending.

## Log
- L1 — User: "ok arrancamos con alt+c #3 ok , animamos durante un judgment day. los workers estan todo el tiempo trabajando, mejor que la pantalla este parada con un imagen estatica de un juego cuando no hacen nada, que se levanten y tomen un cafe a veces, si llevan mucho parado. que te parece? el orchestrator que se mueva y mire la pantalla cuando toca hacer algo, y yo YOU, el Boss de Sudadera negra con capucha, y un B fucsia en el centro. pantalones blanco corto y zapatilla blanca, un keyboard de ordenador en la mano."
- L2 — Plan proposed (S1-S5 as agreed above); user: "ok dale asi mismo".
