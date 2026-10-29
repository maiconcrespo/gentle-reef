# Gentle Office
Pixel-art office (Gentleman-Cute palette, 32-bit style) that visualizes real gentle-shell activity, shipped as its own Pi package from this repo.
Design source: design/agent-office/ (01 overworld HQ, 02 dock pane, 03 story mode). Built step by step to avoid refactors.

## Specs
- S1 — Real agents drive the scene: "Va vinculado a un agente trabajando". Each character maps to a real session/subagent; filler animations (coffee, walking) only fill gaps between real events.
- S2 — Toggle the module: "como activar o desactivar este modulo". Off by default; `agent/gentle-office.json` `{ "enabled": false }` plus an `/office` command; when off, no listeners or server run.
- S3 — Display surfaces: "(Cambiaria el texto que ahroa tenemos por esta animacion)?O tener en una ventana por separado". First a separate localhost browser window (loopback only, token URL, like the gentle-design canvas); later an optional small TUI widget that replaces the working label.
- S4 — Step order: "vamos por pasos, la zona, y luego personage a personage" / "paso a paso para evitar un refactoring". Event contract first, then the zone + orchestrator + coffee pot, then one character type per task.
- S5 — Coffee pot = tokens: "QUe los tokens consumidos sea una jarrita de cafe que se va agotando mientras toman cafe." Pot level = 1 - context usage percent; compaction = brewing a fresh pot.
- S6 — Orchestrator look and behavior: "el orchestrador en la pisarra cuando esta haciendo algo y si no caminando" and "Al orchestrador un bigote mustache rosa,grandey unas gafas monocular."
- S7 — Reviewers and judges: "Cuando hay que llamar los revisores, estaria guay que entraran 2 personages, con maletines, y lupa. Como inspectores. que cada agente se parezca a su roll, y jueces que se ponga los 2 judges a debatir entre ellos."
- S8 — Represent gentle-shell features: "Mira todas las funcionalidades de Gentle-shell para intentar representar en la escena, como gentle-stream, musica. Gentle-design(no se como podria se representar.)etc"
- S9 — Boss = the user, playable: "poder usar gentle-shell practicamente como se fuera un juego. Agregar el boss, como Yo el usuario. Dueno de la empresa con traje y corbata. Ahi me puedo mover yo libremente en el Office.. El input lo puedo ir a un ordenado, y escribir ahi por ejempo o precionando una tecla". The window gets an inbound input channel (boss prompt → orchestrator session); it must be authenticated (session token), loopback-only and Origin-checked.

## Tasks
- T1 — S1, S2, S4: package skeleton (pi-package manifest, peerDependencies), settings toggle, `/office` command, normalized event contract + adapter from Pi events, subagent task status, context usage; unit-tested; no visuals. Route: worker. Commit: 1291251 (51 tests pass). Pending check: load in a real Pi runtime (deferred to T2).
- T2 — S3, S5, S6: loopback server + SSE stream + browser window; zone (static map) + orchestrator + coffee pot driven by T1 events. Route: pending. Commit: pending.
- T3 — S1, S7: resident agents (Explore, Worker, Verify) on dynamic desks from subagent tasks. Commit: pending.
- T4 — S7: review inspectors from review agents / review lifecycle. Commit: pending.
- T5 — S7: judgment-day judges debating. Commit: pending.
- T6 — S8: feature props (music radio, design easel, memory cabinet, web pigeon, todo whiteboard, ask-user bell, MCP rack, codegraph board). Commit: pending.
- T7 — S3: optional TUI mini widget replacing the working label. Commit: pending.
- T8 — S9: boss character (suit + tie) moved with the keyboard; input terminal desk + hotkey that sends the prompt through the authenticated inbound channel. Risk: security (item 2) → independent verify. Commit: pending.

## Log
- L1 — User's original request: "Tengo una idea para gentle shell que me gustaria preparar. al estilo del pokemon de gameboy, y al estilo grafico de gentleshell, algo que ya he visto en otros, una Oficina con los agentes trabajando, pero me gustaria ver u design de propuesta. en los colores de gentle-shell. donde cada agente tiene su mesa y su ordenador, el orchestrador en la pisarra cuando esta haciendo algo y si no caminando. que se reunan, haber una imagen primero si posible. QUe los tokens consumidos sea una jarrita de cafe que se va agotando mientras toman cafe."
- L2 — User: "[Image#1] estos colores. verifica este tema" → palette switched to Gentleman-Cute.
- L3 — User: "Al orchestrador un bigote mustache rosa,grandey unas gafas monocular. estilo con mas bit, cuadraditos estilo 32 bits"
- L4 — User: "Cuando hay que llamar los revisores, estaria guay que entraran 2 personages, con maletines, y lupa. Como inspectores. que cada agente se parezca a su roll, y jueces que se ponga los 2 judges a debatir entre ellos. Que te parece?"
- L5 — User: "OK me gusta y las sugestiones tambiem . Alguna Sugestion de design a mas? Que necesitamos para implementar? vamos por pasos, la zona, y luego personage a personage? Va vinculado a un agente trabajando , como implementariamos en gentle-shell, como activar o desactivar este modulo(Cambiaria el texto que ahroa tenemos por esta animacion)?O tener en una ventana por separado,"
- L6 — User: "OK , si opinas que tus recomendaciones son mejores, acepto. paso a paso para evitar un refactoring. Mira todas las funcionalidades de Gentle-shell para intentar representar en la escena, como gentle-stream, musica. Gentle-design(no se como podria se representar.)etc"
- L7 — Decision: ship as a standalone Pi package in this repo (manifest `pi.extensions`, peerDependencies `*`), window first, TUI widget later. Evidence from explore: Pi events in pi-coding-agent docs/extensions.md; subagent TaskRecord in gentle-pi lib/agents-protocol.ts:10-15,112-143; canvas server pattern in gentle-pi lib/design-canvas-server.ts:15,490,813,908.
- L8 — User: "poder usar gentle-shell practicamente como se fuera un juego. Agregar el boss, como Yo el usuario. Dueno de la empresa con traje y corbata. Ahi me puedo mover yo libremente en el Office.. El input lo puedo ir a un ordenado, y escribir ahi por ejempo o precionando una tecla" → added S9/T8; T1 contract defines the inbound input message type now (not wired) to avoid a later refactor.
- L9 — T1 evidence: `npm test` 51/51 pass (node 24.10 type stripping). Open: subagent pi.events notification only carries taskId+status (agent/label/tokens on TaskRecord, not reachable) → T3 needs a gentle-pi export or store read; tool names for music/web/memory unverified; extension not yet loaded in Pi.
