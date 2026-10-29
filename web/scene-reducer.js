// Pure scene reducer for the Gentle Office page. It turns contract messages
// (snapshot and live OfficeEvents, v: 1) into a scene state, and a view the
// canvas engine draws. No DOM, no timers, no Date.now(): the page passes `at`.
// Plain ES module on purpose: the browser loads it as-is and node tests import it.

export const SCENE_LOG_LIMIT = 40;
export const DESK_COUNT = 4;
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

// Where the orchestrator stands for each state (S6): whiteboard while working, floor while idle, front when it needs you.
const INTENT_BY_STATE = { thinking: "whiteboard", tool: "whiteboard", idle: "floor", "waiting-user": "front" };
const BUBBLE_BY_STATE = { thinking: "idea", tool: "wrench", idle: null, "waiting-user": "question" };

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isPercent = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const isActive = (agent) => ACTIVE_AGENT_STATUSES.has(agent.status);
const isResident = (agent) => RESIDENT_ROLES.has(agent.role);

export function initialScene(deskCount = DESK_COUNT) {
  return {
    orchestrator: { state: "idle" },
    context: { percent: null },
    compaction: null,
    agents: [],
    // desks[i] is the agent id at desk i (or null). bench keeps queued agents in arrival order.
    seats: { desks: Array(deskCount).fill(null), bench: [] },
    // toolStarts[name] is when that tool last started, so its end can log one line with the duration.
    toolStarts: {},
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
  seats = settle(seats, agents);
  return {
    ...state,
    orchestrator: orchestratorOf(snapshot.orchestrator),
    context: { percent },
    compaction: COMPACTION_PHASES.has(snapshot.compaction) ? snapshot.compaction : null,
    agents: agents.filter((agent) => isActive(agent) || seatOf(seats, agent.id) !== null),
    seats,
  };
}

function applyEvent(state, { event, at = 0 }) {
  if (!isRecord(event) || event.v !== CONTRACT_VERSION) return state;
  switch (event.type) {
    case "orchestrator": {
      if (!ORCHESTRATOR_STATES.has(event.state)) return state;
      const next = { ...state, orchestrator: orchestratorOf(event) };
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
        const next = { ...state, toolStarts: rest };
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
      return pushLog(state, { kind: "feature", text: `${event.feature}: ${event.detail}`, at });
    }
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
  seats = settle(seats, agents);
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
  return { ...state, agents, seats: settle(removeSeat(state.seats, id), agents) };
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
  const bench = seats.bench.indexOf(id);
  return bench >= 0 ? { zone: "bench", index: bench } : null;
}

function removeSeat(seats, id) {
  return { desks: seats.desks.map((item) => (item === id ? null : item)), bench: seats.bench.filter((item) => item !== id) };
}

function pruneSeats(seats, keep) {
  return {
    desks: seats.desks.map((item) => (item !== null && keep.has(item) ? item : null)),
    bench: seats.bench.filter((item) => keep.has(item)),
  };
}

/** Moves the first sittable bench agent into each free desk, in bench order. Seated agents never move. */
function settle(seats, agents) {
  const desks = seats.desks.slice();
  let bench = seats.bench.slice();
  for (let index = 0; index < desks.length; index++) {
    if (desks[index] !== null) continue;
    const next = bench.find((id) => agents.some((agent) => agent.id === id && SEATED_AGENT_STATUSES.has(agent.status)));
    if (next === undefined) break;
    desks[index] = next;
    bench = bench.filter((id) => id !== next);
  }
  return { desks, bench };
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
  };
}

function nameOf(agent) {
  return agent.label || (agent.agent === "unknown" ? agent.id : agent.agent);
}

/** 0.4s under ten seconds, 13s under a minute, then 1m 05s. */
function formatDuration(ms) {
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
    agents,
  };
}
