// Pure scene reducer for the Gentle Office page. It turns contract messages
// (snapshot and live OfficeEvents, v: 1) into a scene state, and a view the
// canvas engine draws. No DOM, no timers, no Date.now(): the page passes `at`.
// Plain ES module on purpose: the browser loads it as-is and node tests import it.

export const SCENE_LOG_LIMIT = 40;
export const DESK_COUNT = 4;
// Verify residents (S17) have their own corner with these seats. Extra verify agents take a pod desk, like any resident.
export const VERIFY_DESK_COUNT = 2;
// A feature prop stays lit this long after its last event, and for as long as one of its tools is still running.
export const FEATURE_LINGER_MS = 4000;
const FEATURE_NAMES = ["music", "design", "memory", "web", "todo", "ask", "mcp", "codegraph"];
const CONTRACT_VERSION = 1;

const ORCHESTRATOR_STATES = new Set(["thinking", "tool", "idle", "waiting-user"]);
const COMPACTION_PHASES = new Set(["start", "end", "failed"]);
const AGENT_STATUSES = new Set(["queued", "running", "waiting", "completed", "failed", "cancelled", "timed_out"]);
const ACTIVE_AGENT_STATUSES = new Set(["queued", "running", "waiting"]);
// Only a started (running or waiting) agent can sit at a desk. A queued one waits on the bench.
const SEATED_AGENT_STATUSES = new Set(["running", "waiting"]);
// Residents get a desk and a sprite. Inspectors and judges are logged only until T4/T5.
const RESIDENT_ROLES = new Set(["explore", "worker", "verify"]);
const ROLES = new Set(["explore", "worker", "verify", "inspector", "judge"]);
// Idle staff (S16): one per resident role waits in the lounge by the coffee counter until an agent of its role takes a desk.
export const STAFF_ROLES = ["explore", "worker", "verify"];
const FINISHED_AGENT_STATUSES = new Set(["completed", "failed", "cancelled", "timed_out"]);
const BREAK_STATUS = "on break";
const emptyLounge = () => Object.fromEntries(STAFF_ROLES.map((role) => [role, null]));

// Where the orchestrator stands for each state (S6): whiteboard while working, floor while idle, front when it needs you.
const INTENT_BY_STATE = { thinking: "whiteboard", tool: "whiteboard", idle: "floor", "waiting-user": "front" };
const BUBBLE_BY_STATE = { thinking: "idea", tool: "wrench", idle: null, "waiting-user": "question" };

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isPercent = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const isActive = (agent) => ACTIVE_AGENT_STATUSES.has(agent.status);
const isResident = (agent) => RESIDENT_ROLES.has(agent.role);

export function initialScene(deskCount = DESK_COUNT, verifyCount = VERIFY_DESK_COUNT) {
  return {
    orchestrator: { state: "idle" },
    context: { percent: null },
    compaction: null,
    agents: [],
    // desks[i] is the agent id at pod desk i, verify[i] at verify seat i (or null). bench keeps queued agents in arrival order.
    // lounge[role] is the agent holding that role's staff member (its claim), or null while the staff member idles in the lounge.
    seats: { desks: Array(deskCount).fill(null), verify: Array(verifyCount).fill(null), bench: [], lounge: emptyLounge() },
    // toolStarts[name] is when that tool last started, so its end can log one line with the duration.
    toolStarts: {},
    // features[feature].until is when its prop goes idle again; running[toolName] is the feature of a tool still in flight.
    features: {},
    running: {},
    // The native review (T1): the two inspectors on site, and what they are doing.
    review: initialReview(),
    log: [],
    logSeq: 0,
  };
}

export function reduceScene(state, action) {
  if (!isRecord(action)) return state;
  switch (action.type) {
    case "snapshot":
      return applySnapshot(state, action);
    case "event":
      return applyEvent(state, action);
    case "departed":
      return applyDeparture(state, String(action.id));
    case "note":
      return pushLog(state, { kind: typeof action.kind === "string" ? action.kind : "info", text: String(action.text), at: action.at ?? 0 });
    default:
      return state;
  }
}

function applySnapshot(state, { snapshot }) {
  if (!isRecord(snapshot) || snapshot.v !== CONTRACT_VERSION || !isRecord(snapshot.orchestrator)) return state;
  const orchestratorState = snapshot.orchestrator.state;
  if (!ORCHESTRATOR_STATES.has(orchestratorState)) return state;
  const percent = isRecord(snapshot.context) && isPercent(snapshot.context.percent) ? snapshot.context.percent : null;
  const listed = Array.isArray(snapshot.agents) ? snapshot.agents.filter(isAgent).map(pickAgent) : [];
  const listedIds = new Set(listed.map((agent) => agent.id));
  // Agents the snapshot no longer lists leave their seats. Listed ones keep theirs, so a reconnect does not reseat them.
  let seats = pruneSeats(state.seats, listedIds);
  const agents = [];
  for (const agent of listed) {
    const previous = state.agents.find((item) => item.id === agent.id);
    // A snapshot agent that is finished and has no seat is not on screen; it does not need to appear.
    if (!isActive(agent) && seatOf(seats, agent.id) === null) continue;
    // Restored agents are placed at once: no walk-in animation for the ones the page already showed or the ones it missed.
    agents.push({ ...agent, instant: previous ? previous.instant : true });
    if (isResident(agent) && isActive(agent) && seatOf(seats, agent.id) === null) seats = { ...seats, bench: [...seats.bench, agent.id] };
  }
  seats = withClaims(state.seats, settle(seats, agents), agents);
  return {
    ...state,
    orchestrator: orchestratorOf(snapshot.orchestrator),
    // Only the tool the snapshot still reports can be running; any other end was missed while disconnected.
    running: keepRunning(state.running, snapshot.orchestrator.toolName),
    context: { percent },
    compaction: COMPACTION_PHASES.has(snapshot.compaction) ? snapshot.compaction : null,
    agents: agents.filter((agent) => isActive(agent) || seatOf(seats, agent.id) !== null),
    seats,
    review: endReviewWhenIdle(state.review, orchestratorState),
  };
}

function applyEvent(state, { event, at = 0 }) {
  if (!isRecord(event) || event.v !== CONTRACT_VERSION) return state;
  switch (event.type) {
    case "orchestrator": {
      if (!ORCHESTRATOR_STATES.has(event.state)) return state;
      const next = { ...state, orchestrator: orchestratorOf(event), review: endReviewWhenIdle(state.review, event.state) };
      if (event.state === "waiting-user" && state.orchestrator.state !== "waiting-user") {
        return pushLog(next, { kind: "ask", text: "Waiting for your answer", at });
      }
      return next;
    }
    case "context": {
      if (event.percent !== null && !isPercent(event.percent)) return state;
      return { ...state, context: { percent: event.percent } };
    }
    case "compaction":
      return applyCompaction(state, event.phase, at);
    case "tool": {
      if (typeof event.toolName !== "string") return state;
      const starts = state.toolStarts ?? {};
      if (event.phase === "start") return { ...state, toolStarts: { ...starts, [event.toolName]: at } };
      if (event.phase === "end") {
        const startedAt = Object.hasOwn(starts, event.toolName) ? starts[event.toolName] : undefined;
        const { [event.toolName]: _done, ...rest } = starts;
        const next = endFeature({ ...state, toolStarts: rest }, event.toolName, at);
        const failed = event.ok === false;
        const text = startedAt === undefined
          ? `${event.toolName} ${failed ? "failed" : "finished"}`
          : `${event.toolName}${failed ? " failed" : ""} · ${formatDuration(at - startedAt)}`;
        return pushLog(next, { kind: failed ? "fail" : "tool", text, at });
      }
      return state;
    }
    case "subagent": {
      if (!isAgent(event)) return state;
      return applySubagent(state, event, at);
    }
    case "feature": {
      if (typeof event.feature !== "string" || typeof event.detail !== "string") return state;
      return lightFeature(pushLog(state, { kind: "feature", text: `${event.feature}: ${event.detail}`, at }), event.feature, event.detail, at);
    }
    case "review":
      return applyReview(state, event, at);
    default:
      return state;
  }
}

function applySubagent(state, value, at) {
  const incoming = pickAgent(value);
  const previous = state.agents.find((item) => item.id === incoming.id);
  const agent = { ...incoming, instant: previous ? previous.instant : false };
  const others = state.agents.filter((item) => item.id !== agent.id);
  const agents = [...others, agent];
  let seats = state.seats;
  if (isResident(agent)) {
    // A resident the page has not seated yet joins the bench; settle moves it to a free desk when it may sit.
    if (seatOf(seats, agent.id) === null && isActive(agent)) seats = { ...seats, bench: [...seats.bench, agent.id] };
  } else if (seatOf(seats, agent.id) !== null) {
    // The identity turned out to be a non-resident (inspector or judge): it gives its seat back.
    seats = removeSeat(seats, agent.id);
  }
  seats = withClaims(state.seats, settle(seats, agents), agents);
  // Finished agents stay only while they still hold a seat (they are leaving); the rest are dropped.
  const kept = agents.filter((item) => isActive(item) || seatOf(seats, item.id) !== null);
  const next = { ...state, agents: kept, seats };
  if (previous && previous.status === agent.status) return next;
  return pushLog(next, { kind: "agent", text: `${nameOf(agent)}: ${agent.status}`, at });
}

// The page reports `departed` once the agent has walked out. Only then does its seat free up for the next in line.
function applyDeparture(state, id) {
  if (seatOf(state.seats, id) === null) return state;
  const agents = state.agents.filter((agent) => agent.id !== id);
  return { ...state, agents, seats: withClaims(state.seats, settle(removeSeat(state.seats, id), agents), agents) };
}

/** A feature event is sent when its tool starts: the prop lights and stays lit while that tool runs. */
function lightFeature(state, feature, toolName, at) {
  return {
    ...state,
    features: { ...(state.features ?? {}), [feature]: { until: at + FEATURE_LINGER_MS } },
    running: { ...(state.running ?? {}), [toolName]: feature },
  };
}

/** The tool ended: its prop lingers for the usual time from now. */
function endFeature(state, toolName, at) {
  const running = state.running ?? {};
  if (!Object.hasOwn(running, toolName)) return state;
  const { [toolName]: feature, ...rest } = running;
  return { ...state, running: rest, features: { ...(state.features ?? {}), [feature]: { until: at + FEATURE_LINGER_MS } } };
}

function keepRunning(running = {}, toolName) {
  return Object.fromEntries(Object.entries(running).filter(([tool]) => tool === toolName));
}

/* ---------- review inspectors (T1, S1-S4) ---------- */
// Phases on site: arriving, inspecting, and verdict (approved, standing by the check). `leaving` is walking out; `idle` is not in the room.
const ON_SITE_REVIEW = new Set(["arriving", "inspecting", "verdict"]);
const REVIEW_VERDICTS = new Set(["approved", "correction", "failed"]);
const REVIEW_STATUS = { arriving: "arriving", inspecting: "inspecting the desks", verdict: "approved ✓" };
const VERDICT_LINE = {
  approved: { kind: "tool", text: "review approved ✓" },
  correction: { kind: "fail", text: "review correction required !" },
  failed: { kind: "fail", text: "review failed !" },
};

function initialReview() {
  return { phase: "idle", count: 0, verdict: null, names: [] };
}

/** Inspector A and B are named after the lenses the review asked for, else "Inspector A" and "Inspector B". */
export function inspectorLabel(names, index) {
  const lens = names[index];
  return lens ? `${lens[0].toUpperCase()}${lens.slice(1)}` : `Inspector ${"AB"[index]}`;
}

/**
 * The review lifecycle from the contract's review events. A verdict or an acknowledgement with no inspector on site changes nothing.
 * An approved verdict keeps them on site for the check; a correction or a failure sends them out, as does a sign-off (S3, S4).
 */
function applyReview(state, event, at) {
  const current = state.review;
  switch (event.phase) {
    case "arrive": {
      const names = Array.isArray(event.names) ? event.names : current.names;
      // A status call inside a review that is already on site does not walk them in again.
      if (ON_SITE_REVIEW.has(current.phase)) return { ...state, review: { ...current, names } };
      return { ...state, review: { phase: "arriving", count: 0, verdict: null, names } };
    }
    case "inspect":
      return { ...state, review: { ...current, phase: "inspecting", count: typeof event.count === "number" && event.count > 0 ? event.count : 1, verdict: null } };
    case "verdict": {
      if (!ON_SITE_REVIEW.has(current.phase) || !REVIEW_VERDICTS.has(event.verdict)) return state;
      const phase = event.verdict === "approved" ? "verdict" : "leaving";
      return pushLog({ ...state, review: { ...current, phase, verdict: event.verdict } }, { ...VERDICT_LINE[event.verdict], at });
    }
    case "acknowledged":
      return ON_SITE_REVIEW.has(current.phase) ? { ...state, review: { ...current, phase: "leaving" } } : state;
    default:
      return state;
  }
}

/** The session went idle (agent_settled): inspectors on site leave, so they never stay forever (S4). */
function endReviewWhenIdle(review, orchestratorState) {
  return orchestratorState === "idle" && ON_SITE_REVIEW.has(review.phase) ? { ...review, phase: "leaving" } : review;
}

function reviewView(review) {
  return {
    phase: review.phase,
    count: review.count,
    verdict: review.verdict,
    labels: [inspectorLabel(review.names, 0), inspectorLabel(review.names, 1)],
  };
}

/** Whether a prop entry from sceneView is lit at `now` (the page's clock, in the same units as `at`). */
export function featureActive(entry, now) {
  return Boolean(entry) && (entry.running || now < entry.until);
}

function applyCompaction(state, phase, at) {
  if (!COMPACTION_PHASES.has(phase)) return state;
  if (phase === "start") {
    return pushLog({ ...state, compaction: "start" }, { kind: "coffee", text: "Compaction started: the orchestrator brews a fresh pot", at });
  }
  if (phase === "end") {
    // Pi reports no usage right after compaction, so the stale reading is dropped and the pot is full until the next one.
    return pushLog({ ...state, compaction: "end", context: { percent: null } }, { kind: "coffee", text: "Fresh pot brewed: context compacted", at });
  }
  return pushLog({ ...state, compaction: "failed" }, { kind: "fail", text: "Compaction failed", at });
}

/** Where an agent stands: a desk index, a bench index, or null when it has no place in the room. */
export function seatOf(seats, id) {
  const desk = seats.desks.indexOf(id);
  if (desk >= 0) return { zone: "desk", index: desk };
  const verify = seats.verify.indexOf(id);
  if (verify >= 0) return { zone: "verify", index: verify };
  const bench = seats.bench.indexOf(id);
  return bench >= 0 ? { zone: "bench", index: bench } : null;
}

// Every seat that holds an agent, the pod and the verify corner alike.
const seated = (seats) => [...seats.desks, ...seats.verify];

function removeSeat(seats, id) {
  return {
    ...seats,
    desks: seats.desks.map((item) => (item === id ? null : item)),
    verify: seats.verify.map((item) => (item === id ? null : item)),
    bench: seats.bench.filter((item) => item !== id),
  };
}

function pruneSeats(seats, keep) {
  return {
    ...seats,
    desks: seats.desks.map((item) => (item !== null && keep.has(item) ? item : null)),
    verify: seats.verify.map((item) => (item !== null && keep.has(item) ? item : null)),
    bench: seats.bench.filter((item) => keep.has(item)),
  };
}

/**
 * Staff claims (S16). A claim is held by an agent sitting at a desk, so it ends when that seat is freed (the agent has walked back to the lounge).
 * A resident of a staff role claims its staff member the first time it is seated, from the door, the bench or a snapshot.
 * Extras of a role whose staff member is busy take a desk or the bench as before.
 */
function withClaims(before, seats, agents) {
  const lounge = {};
  for (const role of STAFF_ROLES) {
    const holder = before.lounge[role];
    lounge[role] = holder !== null && seated(seats).includes(holder) ? holder : null;
  }
  for (const id of seated(seats)) {
    if (id === null || seated(before).includes(id)) continue;
    const agent = agents.find((item) => item.id === id);
    if (agent && agent.claims && lounge[agent.role] === null) lounge[agent.role] = id;
  }
  return { ...seats, lounge };
}

/**
 * Moves sittable bench agents into free seats, in bench order. Seated agents never move.
 * Verify agents fill the verify corner first (S17); any agent may then take a pod desk, so explore and worker never take a verify seat.
 */
function settle(seats, agents) {
  const sittable = (id) => agents.some((agent) => agent.id === id && SEATED_AGENT_STATUSES.has(agent.status));
  const isVerify = (id) => agents.some((agent) => agent.id === id && agent.role === "verify");
  const verify = seats.verify.slice();
  const desks = seats.desks.slice();
  let bench = seats.bench.slice();
  for (let index = 0; index < verify.length; index++) {
    if (verify[index] !== null) continue;
    const next = bench.find((id) => sittable(id) && isVerify(id));
    if (next === undefined) break;
    verify[index] = next;
    bench = bench.filter((id) => id !== next);
  }
  for (let index = 0; index < desks.length; index++) {
    if (desks[index] !== null) continue;
    const next = bench.find((id) => sittable(id));
    if (next === undefined) break;
    desks[index] = next;
    bench = bench.filter((id) => id !== next);
  }
  return { ...seats, desks, verify, bench };
}

function orchestratorOf(source) {
  return typeof source.toolName === "string" ? { state: source.state, toolName: source.toolName } : { state: source.state };
}

function isAgent(value) {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 && AGENT_STATUSES.has(value.status);
}

function pickAgent(value) {
  return {
    id: value.id,
    agent: typeof value.agent === "string" ? value.agent : "unknown",
    role: ROLES.has(value.role) ? value.role : "worker",
    label: typeof value.label === "string" ? value.label : "",
    status: value.status,
    // Only an explicit resident role claims a staff member; an unrecognised role takes a desk as before but never claims.
    claims: RESIDENT_ROLES.has(value.role),
  };
}

function nameOf(agent) {
  return agent.label || (agent.agent === "unknown" ? agent.id : agent.agent);
}

/** 0.4s under ten seconds, 13s under a minute, then 1m 05s. */
export function formatDuration(ms) {
  const safe = Math.max(0, ms);
  if (safe < 10_000) return `${(safe / 1000).toFixed(1)}s`;
  const seconds = Math.round(safe / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function pushLog(state, entry) {
  const logSeq = state.logSeq + 1;
  return { ...state, logSeq, log: [{ id: logSeq, ...entry }, ...state.log].slice(0, SCENE_LOG_LIMIT) };
}

/**
 * What the canvas draws. The pot level is 1 - percent/100; unknown usage shows a full pot labelled "—" by the page.
 * `agents` lists the residents on a desk or the bench. Each has `seat`, `leaving` (finished, walking out) and
 * `instant` (placed at once, no walk-in).
 */
export function sceneView(state) {
  const orchestratorState = state.orchestrator.state;
  const brewing = state.compaction === "start";
  const percent = state.context.percent;
  const agents = state.agents
    .filter(isResident)
    .map((agent) => ({
      id: agent.id,
      agent: agent.agent,
      role: agent.role,
      label: agent.label,
      status: agent.status,
      seat: seatOf(state.seats, agent.id),
      leaving: !isActive(agent),
      instant: agent.instant,
      // The staff member of this role is this agent: it walks from the lounge and walks back to it.
      claimed: state.seats.lounge[agent.role] === agent.id,
    }))
    .filter((agent) => agent.seat !== null);
  return {
    intent: brewing ? "coffee" : INTENT_BY_STATE[orchestratorState],
    writing: !brewing && (orchestratorState === "thinking" || orchestratorState === "tool"),
    bubble: brewing ? "cup" : BUBBLE_BY_STATE[orchestratorState],
    brewing,
    orchestrator: orchestratorState,
    percent: percent === null ? null : Math.round(percent),
    potLevel: percent === null ? 1 : Math.round((1 - percent / 100) * 10000) / 10000,
    activeAgents: state.agents.filter(isActive).length,
    // Review inspectors (T1): `phase` is idle, arriving, inspecting, verdict or leaving; `labels` names the two of them.
    review: reviewView(state.review),
    agents,
    // Idle staff: present in the lounge, or claimed by the agent named here.
    staff: STAFF_ROLES.map((role) => ({ role, present: state.seats.lounge[role] === null, claimedBy: state.seats.lounge[role] })),
    // Per prop: `running` while one of its tools is in flight, and `until` for the linger. Use featureActive(entry, now).
    features: Object.fromEntries(FEATURE_NAMES.map((name) => [name, {
      running: Object.values(state.running ?? {}).includes(name),
      until: state.features?.[name]?.until ?? 0,
    }])),
  };
}

/**
 * The team list: residents first (as drawn), then each idle staff member on break. Pure over sceneView, so the page and tests read the same rows.
 */
export function teamRows(view) {
  const review = view.review;
  const onSite = review && ON_SITE_REVIEW.has(review.phase) ? review : null;
  return [
    ...view.agents.map((agent) => ({ kind: "resident", id: agent.id, role: agent.role, label: agent.label, status: agent.status })),
    // The inspectors on site (T1), after the residents and before the staff on break.
    ...(onSite ? onSite.labels.map((label) => ({ kind: "inspector", role: "inspector", label, status: REVIEW_STATUS[onSite.phase] })) : []),
    ...view.staff.filter((item) => item.present).map((item) => ({ kind: "staff", role: item.role, status: BREAK_STATUS })),
  ];
}

/* ---------- Narrator (T14): contract events to dialog lines, and the dialog queue. ---------- */

export const NARRATOR_QUEUE_LIMIT = 20;
/** Typewriter speed: one character per this many milliseconds. */
export const TYPE_MS_PER_CHAR = 28;
/** A finished line waits this long before the next queued line replaces it. */
export const AUTO_ADVANCE_MS = 2500;
/** Pause before a backlog moves on: with three or more lines waiting, each one gets this shorter pause. */
export const BACKLOG_ADVANCE_MS = 800;
const BACKLOG_AT = 3;

const ORCHESTRATOR = "ORCHESTRATOR";
const INSPECTORS = "INSPECTORS";
// One sentence per feature prop (S8). Unknown features fall back to a generic line.
const FEATURE_SENTENCE = {
  music: "playing gentle music",
  design: "sketching on the easel",
  memory: "saving to memory",
  web: "searching the web",
  todo: "updating the to-do board",
  ask: "asking you a question",
  review: "calling the inspectors",
  judgment: "calling the judges",
  mcp: "calling an MCP tool",
  codegraph: "reading the code map",
};
// Status changes a subagent can narrate. A first sighting gets an "arrived, " prefix.
const AGENT_SENTENCE = {
  queued: "waiting for a desk.",
  running: "starts typing…",
  waiting: "waiting for a reply.",
  completed: "finished ✓",
  failed: "failed !",
  cancelled: "cancelled !",
  timed_out: "timed out !",
};
const AGENT_BAD = new Set(["failed", "cancelled", "timed_out"]);

// ask_user tools have their own line: the orchestrator's waiting state says it, so the tool itself stays quiet.
const isAskTool = (name) => typeof name === "string" && name.startsWith("ask_user");

export function initialNarrator() {
  return { orchestrator: "idle", statuses: {}, toolStarts: {} };
}

const say = (speaker, text, tone = "info") => ({ speaker, text, tone });

/**
 * One contract event in, the lines it produces out. `state` is the narrator's own memory (last orchestrator state,
 * last status per subagent, tool start times). `context.claimant` says the agent holds its role's staff member, so a finish
 * narrates the walk back to the coffee. Returns { state, lines }.
 */
export function narrate(state, event, at = 0, context = {}) {
  if (!isRecord(event) || event.v !== CONTRACT_VERSION) return { state, lines: [] };
  switch (event.type) {
    case "orchestrator":
      return narrateOrchestrator(state, event);
    case "tool":
      return narrateTool(state, event, at);
    case "feature": {
      const sentence = FEATURE_SENTENCE[event.feature] ?? "using a tool";
      return { state, lines: [say(ORCHESTRATOR, `${sentence}…`)] };
    }
    case "compaction":
      return narrateCompaction(state, event.phase);
    case "review":
      return narrateReview(state, event);
    case "subagent":
      return narrateSubagent(state, event, context);
    default:
      return { state, lines: [] };
  }
}

function narrateOrchestrator(state, event) {
  if (!ORCHESTRATOR_STATES.has(event.state)) return { state, lines: [] };
  const previous = state.orchestrator;
  const next = { ...state, orchestrator: event.state };
  // A turn starts from the floor or after an answer; a tool hand-back inside the turn is not a new line.
  if (event.state === "thinking" && (previous === "idle" || previous === "waiting-user")) {
    return { state: next, lines: [say(ORCHESTRATOR, "thinking…")] };
  }
  if (event.state === "waiting-user" && previous !== "waiting-user") {
    return { state: next, lines: [say(ORCHESTRATOR, "waiting for your answer.", "ask")] };
  }
  if (event.state === "idle" && previous !== "idle" && previous !== "waiting-user") {
    return { state: next, lines: [say(ORCHESTRATOR, "done, back on the floor.", "ok")] };
  }
  return { state: next, lines: [] };
}

function narrateTool(state, event, at) {
  const name = event.toolName;
  if (typeof name !== "string" || isAskTool(name)) return { state, lines: [] };
  if (event.phase === "start") {
    return { state: { ...state, toolStarts: { ...state.toolStarts, [name]: at } }, lines: [say(ORCHESTRATOR, `running ${name}…`)] };
  }
  if (event.phase !== "end") return { state, lines: [] };
  const { [name]: startedAt, ...rest } = state.toolStarts;
  const failed = event.ok === false;
  const outcome = failed ? "failed !" : "done ✓";
  const text = startedAt === undefined ? `${name} ${outcome}` : `${name} ${outcome} · ${formatDuration(at - startedAt)}`;
  return { state: { ...state, toolStarts: rest }, lines: [say(ORCHESTRATOR, text, failed ? "fail" : "ok")] };
}

/** The inspectors (T1): arrival, the lenses they run, the verdict, and the sign-off. */
function narrateReview(state, event) {
  switch (event.phase) {
    case "arrive":
      return { state, lines: [say(INSPECTORS, "arriving at the door.")] };
    case "inspect": {
      const count = event.count;
      const lenses = typeof count === "number" && count >= 1 ? `, ${count} ${count === 1 ? "lens" : "lenses"}` : "";
      return { state, lines: [say(INSPECTORS, `inspecting the desks${lenses}…`)] };
    }
    case "verdict":
      if (event.verdict === "approved") return { state, lines: [say(INSPECTORS, "approved ✓", "ok")] };
      if (event.verdict === "correction") return { state, lines: [say(INSPECTORS, "correction required !", "fail")] };
      if (event.verdict === "failed") return { state, lines: [say(INSPECTORS, "review failed !", "fail")] };
      return { state, lines: [] };
    case "acknowledged":
      return { state, lines: [say(INSPECTORS, "signed off, leaving.", "ok")] };
    default:
      return { state, lines: [] };
  }
}

function narrateCompaction(state, phase) {
  if (phase === "start") return { state, lines: [say(ORCHESTRATOR, "compacting: brewing a fresh pot…", "coffee")] };
  if (phase === "end") return { state, lines: [say(ORCHESTRATOR, "fresh pot brewed. Context compacted.", "coffee")] };
  if (phase === "failed") return { state, lines: [say(ORCHESTRATOR, "compaction failed !", "fail")] };
  return { state, lines: [] };
}

function narrateSubagent(state, event, context) {
  if (typeof event.id !== "string" || !Object.hasOwn(AGENT_SENTENCE, event.status)) return { state, lines: [] };
  const previous = Object.hasOwn(state.statuses, event.id) ? state.statuses[event.id] : undefined;
  const next = { ...state, statuses: { ...state.statuses, [event.id]: event.status } };
  if (previous === event.status) return { state: next, lines: [] };
  const sentence = AGENT_SENTENCE[event.status];
  const text = previous === undefined ? `arrived, ${sentence}` : sentence;
  const tone = event.status === "completed" ? "ok" : AGENT_BAD.has(event.status) ? "fail" : "info";
  const lines = [say(speakerOf(event), text, tone)];
  // A claimant walks back to the lounge: its staff member narrates the break (S16).
  if (context.claimant === true && FINISHED_AGENT_STATUSES.has(event.status)) {
    lines.push(say(String(event.role).toUpperCase(), "back to the coffee.", "info"));
  }
  return { state: next, lines };
}

/** The label the player knows the agent by; the role stands in when the label is empty. */
function speakerOf(event) {
  if (typeof event.label === "string" && event.label !== "") return event.label;
  if (typeof event.agent === "string" && event.agent !== "unknown") return event.agent;
  return String(event.role ?? "agent");
}

/** The page reconnected: remember what the snapshot shows so its agents do not arrive again as news. No lines. */
export function narrateSnapshot(state, snapshot) {
  if (!isRecord(snapshot) || snapshot.v !== CONTRACT_VERSION || !isRecord(snapshot.orchestrator)) return state;
  const orchestrator = ORCHESTRATOR_STATES.has(snapshot.orchestrator.state) ? snapshot.orchestrator.state : state.orchestrator;
  const statuses = {};
  for (const agent of Array.isArray(snapshot.agents) ? snapshot.agents : []) {
    if (isRecord(agent) && typeof agent.id === "string" && Object.hasOwn(AGENT_SENTENCE, agent.status)) statuses[agent.id] = agent.status;
  }
  return { ...state, orchestrator, statuses };
}

/**
 * Which actor the story camera should follow for this event, or null when the event does not move it.
 * The page passes the result to the engine: the orchestrator, a resident by id, or a feature prop by name.
 */
export function actorOf(event) {
  if (!isRecord(event) || event.v !== CONTRACT_VERSION) return null;
  switch (event.type) {
    case "orchestrator":
    case "tool":
    case "compaction":
      return { kind: "orchestrator" };
    case "review":
      return { kind: "review" };
    case "subagent":
      return typeof event.id === "string" ? { kind: "resident", id: event.id } : null;
    case "feature":
      return typeof event.feature === "string" ? { kind: "feature", feature: event.feature } : null;
    default:
      return null;
  }
}

/** The dialog box: the line on screen, the lines waiting behind it, and whether an ask prompt holds the box. */
export function initialDialog() {
  return { current: null, queue: [], askOpen: false, seq: 0 };
}

export function reduceDialog(state, action) {
  switch (action.type) {
    case "lines": {
      let seq = state.seq;
      const fresh = [];
      for (const line of action.lines) fresh.push({ id: ++seq, ...line });
      let queue = [...state.queue, ...fresh];
      let current = state.current;
      if (current === null && queue.length > 0) current = queue.shift();
      // Overflow drops the oldest pending lines: the player sees what happened most recently.
      if (queue.length > NARRATOR_QUEUE_LIMIT) queue = queue.slice(-NARRATOR_QUEUE_LIMIT);
      return { ...state, current, queue, seq };
    }
    case "next": {
      // With nothing queued the last line stays on screen, like a game text box.
      if (state.queue.length === 0) return state;
      const [current, ...queue] = state.queue;
      return { ...state, current, queue };
    }
    case "ask":
      return { ...state, askOpen: Boolean(action.open) };
    default:
      return state;
  }
}

/** What the box shows: the ask prompt while it is open (it takes priority), else the current line, else nothing. */
export function dialogView(state) {
  const mode = state.askOpen ? "ask" : state.current ? "line" : "none";
  return { mode, line: state.current, pending: state.queue.length };
}

/** How long a finished line stays before the next one takes the box, given how many lines wait behind it. */
export function dwellMs(pending) {
  return pending >= BACKLOG_AT ? BACKLOG_ADVANCE_MS : AUTO_ADVANCE_MS;
}

/** How many characters of `text` the typewriter has revealed after `elapsedMs`. Reduced motion shows the whole line. */
export function typedLength(text, elapsedMs, reduced) {
  if (reduced) return text.length;
  if (elapsedMs <= 0) return 0;
  return Math.min(text.length, Math.floor(elapsedMs / TYPE_MS_PER_CHAR));
}
