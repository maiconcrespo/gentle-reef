# Terminal scene life

The Gentle HQ room in the terminal shows who is doing what: a panel toggle, judges that debate, workers that rest, an orchestrator that works at its screen, and the user as the Boss.
Branch: feat/terminal-scene-life (from main 64cb43b). Issues: #3 (judges). Follows odd/tasks/terminal-stage.md (T11d is S3 here).

## Specs
- S1 — Side panel toggle: "cuando uso el alt+c el chat se oculta pero , tendria que ocultar todo el lateral inclyendo el PARTY." Agreed: alt+c hides PARTY, notices and CHAT; the room is centred in the freed width (it grows when the side panel was what limited it) and one muted key line remains.
- S2 — Judges (#3): "#3 ok , animamos durante un judgment day." Agreed: while a `jd-judge-*` agent runs, the two judges debate in turns (speech bubble with "…" one and then the other) and the gavel moves; when they finish, the gavel strikes once and they rest.
- S3 — Workers: "los workers estan todo el tiempo trabajando, mejor que la pantalla este parada con un imagen estatica de un juego cuando no hacen nada, que se levanten y tomen un cafe a veces, si llevan mucho parado." Agreed: a desk's screen moves only while that worker works; otherwise it shows a still game picture. After about 3 minutes without work a worker stands at the coffee corner with a cup; it goes back to its desk when a worker starts. The animation is off while nobody acts, so the move to the coffee shows on the next frame (no walk).
- S4 — Orchestrator: "el orchestrator que se mueva y mire la pantalla cuando toca hacer algo". Agreed: a monitor on the orchestrator's desk; while it thinks or runs a tool it stands facing the monitor; while it waits it rests behind the desk with its cane.
- S6 — Pasted images (L4): "al poegar una imagen podria ir al cuadro de design de la escena. has visto como se rompe todo." Pasting an image must not break the scene. Agreed (L6): an ITEMS tray, a hole in the scene where the thumbnail lands, framed by the overlay.
- S5 — The user as the Boss: "y yo YOU, el Boss de Sudadera negra con capucha, y un B fucsia en el centro. pantalones blanco corto y zapatilla blanca, un keyboard de ordenador en la mano." Placement agreed ("ok dale asi mismo"): in front of the orchestrator's desk while the orchestrator works, by the door when everything is still.

## Tasks
- T1 — S1: alt+c hides the whole side panel. gameLayout({ panel: false }) gives an inset that centres the room, hiddenPanel() the blank side with the key hint; the toggle forces one full repaint. Route: inline. Commit: 51cae8e. Tests: `npm test` 427/427. Pending: the user's look in Ghostty.
- T1b — S1 (L4): alt+c left the room black. A full repaint (forced by alt+c, or by a resize) deletes every Kitty image its lines name with `a=d,d=I`, data included; the room's line only places the image (T10), and an unchanged scene never sent the data again, so the room stayed black until the next animated frame. Now each render checks `tui.fullRedraws` after Pi writes it (roomDataLost) and sends the room again under the other id. Route: inline. Commit: see git log (fix(stage): send the room again after a full repaint). Tests: `npm test` 428/428. Pending: the user's look in Ghostty.
- T7 — S6 (L5, L6): ITEMS tray. gentle-shell's thumbnails (label row + up to 40 x 6 cells while idle, column 0 above the editor) are an image line pi-tui keeps over the overlay. The scene reads the `[Image#N]` chips from the editor's draft and leaves a framed hole in the bottom-left corner (itemChips, itemsTray, composeGame items); the dialog moves above it. Sizes copied from gentle-pi (accepted coupling, L6). Route: inline. Commit: see git log (feat(stage): ITEMS tray). Tests: `npm test` 432/432. Pending: the user's look in Ghostty.
- T3 — S3: worker screens and the coffee break (before T2, L4). Route: inline. Commit: pending.
- T2 — S2: judges debate during a judgment day, gavel strike at the end. Route: inline. Commit: pending.
- T4 — S4: orchestrator at its monitor. Route: inline. Commit: pending.
- T5 — S5: the Boss sprite and its two places. Route: inline. Commit: pending.
- T6 — S1-S5: README and docs/reference.md. Route: inline. Commit: pending.

## Log
- L1 — User: "ok arrancamos con alt+c #3 ok , animamos durante un judgment day. los workers estan todo el tiempo trabajando, mejor que la pantalla este parada con un imagen estatica de un juego cuando no hacen nada, que se levanten y tomen un cafe a veces, si llevan mucho parado. que te parece? el orchestrator que se mueva y mire la pantalla cuando toca hacer algo, y yo YOU, el Boss de Sudadera negra con capucha, y un B fucsia en el centro. pantalones blanco corto y zapatilla blanca, un keyboard de ordenador en la mano."
- L2 — Plan proposed (S1-S5 as agreed above); user: "ok dale asi mismo".
- L3 — User: "para un momento cuando puedas guarda la info, tengo que reiniciar el ordanador. par que vuelva todo actualizado." Stopped after T1; T2-T6 next.
- L4 — User (with screenshots: the room black after alt+c, pasted image thumbnails over the dialog): "T3 antes que T2, has visto que al apretar alt-c, la imagen de la escena se pone negro. al poegar una imagen podria ir al cuadro de design de la escena. has visto como se rompe todo. ?" Then: "Alt+c rompe todo asi, apenas si no hay ningun proceso para actualizar la pantalla, si hay algo en seguida se vuelve a residesenar y no se nota".
- L5 — User: "T7(S6, Esquivar?)Podriamos hacer un recuadro para que aparesca la imagen ahi sin esciquivar no? Asi el overlay, lo contornaria. Le hariamos un hueco en la escena Ya que es un area vacia.  En este hueco no se lo que podriamos hacer."
- L6 — Proposed an ITEMS tray copying gentle-shell's sizes (40 x 6, one label row); user: "OK probamos asi, haber que sale. Y luego actualizamos el repo. creo que vamos bien avanzado. para qu puedan probar."
