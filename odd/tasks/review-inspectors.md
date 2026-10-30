# Review inspectors (issue #2)

Draw the native review lifecycle in the office as two inspectors, driven by the `gentle_review*` tool calls.
Branch: feat/2-review-inspectors. Parent doc: odd/tasks/gentle-office.md (T4, S7).

## Specs
- S1 — Inspectors: "Cuando hay que llamar los revisores, estaria guay que entraran 2 personages, con maletines, y lupa. Como inspectores. que cada agente se parezca a su roll" (gentle-office S7).
- S2 — Visible review/RDD work: "cuando aparece callin the inspector no veo los resonages ddel review y RDD trabajando en la escena". Today the `review` feature only narrates "calling the inspectors" (web/scene-reducer.js:407) and nothing is drawn.
- S3 — Driven by tool calls, not subagents (decided; user: "si"). Reviewer lenses run inside `gentle_review_capture` / `gentle_review_capture_group` through the Pi host relay, so no `subagent` event with role `inspector` ever arrives. Mapping:
  | Tool event | Scene |
  |---|---|
  | `gentle_review` start / inspect | inspectors walk in through the door |
  | `gentle_review_capture*` running | they inspect the desks with magnifying glasses |
  | capture ends | verdict: `✓` approved or `!` correction |
  | `acknowledge-approved` | they sign off and leave |
- S4 — Real data only (gentle-office S1): a scene state changes only on a real event. Inspectors leave on `acknowledge-approved`, on a capture end that is not approved and has no follow-up, or when the session goes idle (`agent_settled`), so they never stay forever.

## Tasks
- T1 — S1-S4: contract `review` event (additive, v1 stays), adapter reads `args.operation` / bindings count at start and the approved / correction state from the result at end (bounded, tolerant), reducer state + narration, two inspector sprites (briefcase + magnifying glass) with enter / inspect / verdict / leave in the engine, story camera and party list include them; docs/reference.md and README roadmap updated. Route: worker (context backstop). Commits: 8f86ae2 (review events), 780efd9 (reducer state, narration), 4fdd46c (tour routes, review-gone), 2495c7c (sprites, walking, verdict, leave), c85f52a (story camera, PARTY, team labels), 1e2d688 (docs). Tests: `npm test` 320/320.

## Log
- L1 — User: "cuando aparece callin the inspector no veo los resonages ddel review y RDD trabajando en la escena"
- L2 — Assistant proposed the tool-call mapping (S3) and the order: merge #9, comment #2, start #2. User: "si". #9 merged (f8a2c32); comment posted on #2.
