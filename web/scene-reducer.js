// Pure scene reducer for the Gentle Office page. It turns contract messages
// (snapshot and live OfficeEvents, v: 1) into a scene state, and a view the
// canvas engine draws. No DOM, no timers, no Date.now(): the page passes `at`.
// Plain ES module on purpose: the browser loads it as-is and node tests import it.

export const SCENE_LOG_LIMIT = 40;
const CONTRACT_VERSION = 1;

const ORCHESTRATOR_STATES = new Set(["thinking", "tool", "idle", "waiting-user"]);
const COMPACTION_PHASES = new Set(["start", "end", "failed"]);
const AGENT_STATUSES = new Set(["queued", "running", "waiting", "completed", "failed", "cancelled", "timed_out"]);
const ACTIVE_AGENT_STATUSES = new Set(["queued", "running", "waiting"]);

// Where the orchestrator stands for each state (S6): whiteboard while working, floor while idle, front when it needs you.
const INTENT_BY_STATE = { thinking: "whiteboard", tool: "whiteboard", idle: "floor", "waiting-user": "front" };
const BUBBLE_BY_STATE = { thinking: "idea", tool: "wrench", idle: null, "waiting-user": "question" };

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isPercent = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

export function initialScene() {
  return {
    orchestrator: { state: "idle" },
    context: { percent: null },
    compaction: null,
    agents: [],
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
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents.filter(isAgent).map(pickAgent) : [];
  return {
    ...state,
    orchestrator: orchestratorOf(snapshot.orchestrator),
    context: { percent },
    compaction: COMPACTION_PHASES.has(snapshot.compaction) ? snapshot.compaction : null,
    agents,
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
      if (event.phase === "start") return pushLog(state, { kind: "tool", text: `${event.toolName} started`, at });
      if (event.phase === "end") {
        return event.ok === false
          ? pushLog(state, { kind: "fail", text: `${event.toolName} failed`, at })
          : pushLog(state, { kind: "tool", text: `${event.toolName} finished`, at });
      }
      return state;
    }
    case "subagent": {
      if (!isAgent(event)) return state;
      const agent = pickAgent(event);
      const agents = [...state.agents.filter((item) => item.id !== agent.id), agent];
      const name = agent.label || (agent.agent === "unknown" ? agent.id : agent.agent);
      return pushLog({ ...state, agents }, { kind: "agent", text: `${name}: ${agent.status}`, at });
    }
    case "feature": {
      if (typeof event.feature !== "string" || typeof event.detail !== "string") return state;
      return pushLog(state, { kind: "feature", text: `${event.feature}: ${event.detail}`, at });
    }
    default:
      return state;
  }
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
    label: typeof value.label === "string" ? value.label : "",
    status: value.status,
  };
}

function pushLog(state, entry) {
  const logSeq = state.logSeq + 1;
  return { ...state, logSeq, log: [{ id: logSeq, ...entry }, ...state.log].slice(0, SCENE_LOG_LIMIT) };
}

/** What the canvas draws. The pot level is 1 - percent/100; unknown usage shows a full pot labelled "—" by the page. */
export function sceneView(state) {
  const orchestratorState = state.orchestrator.state;
  const brewing = state.compaction === "start";
  const percent = state.context.percent;
  return {
    intent: brewing ? "coffee" : INTENT_BY_STATE[orchestratorState],
    writing: !brewing && (orchestratorState === "thinking" || orchestratorState === "tool"),
    bubble: brewing ? "cup" : BUBBLE_BY_STATE[orchestratorState],
    brewing,
    orchestrator: orchestratorState,
    percent,
    potLevel: percent === null ? 1 : Math.round((1 - percent / 100) * 10000) / 10000,
    activeAgents: state.agents.filter((agent) => ACTIVE_AGENT_STATUSES.has(agent.status)).length,
  };
}
