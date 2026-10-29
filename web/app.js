// Gentle Office page: connects the SSE stream to the scene reducer, the canvas engine and the sidebar.
// Everything from the stream goes in through textContent, never innerHTML.
import { SCENE_LOG_LIMIT, initialScene, reduceScene, sceneView } from "./scene-reducer.js";
import { OFFICE_CONFIG, createOfficeEngine, drawPot } from "./office-engine.js";

const $ = (id) => document.getElementById(id);
const el = (tag, className) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	return node;
};

const liveEl = $("live");
const logEl = $("log");
const crewEl = $("crew");
const canvas = $("office");
const potCtx = $("pot").getContext("2d");
const askEl = $("askDialog");

const ROLE_LABEL = { explore: "Explore", worker: "Worker", verify: "Verify" };
const STATUS_LABEL = {
	queued: "queued, waiting for a desk",
	running: "typing",
	waiting: "waiting for a reply",
	completed: "done, heading out",
	failed: "failed, heading out",
	cancelled: "cancelled, heading out",
	timed_out: "timed out, heading out",
};

let scene = initialScene(OFFICE_CONFIG.desks.length);
let view = sceneView(scene);
let seenLogId = 0;
let lastLabel = "";
let hasDropped = false;

const engine = createOfficeEngine(canvas, OFFICE_CONFIG, {
	onPot: ({ level, brewing, time }) => drawPot(potCtx, level, time, brewing),
	// An agent has walked out of the door: its seat frees up for the next one in the bench.
	onDeparted: (id) => dispatch({ type: "departed", id }),
});

// Layout: "full" is the desk window; "dock" is the narrow pane from design/agent-office/02-dock-pane.html. ?layout= wins for
// this load (the /office dock entry uses it); otherwise the saved toggle choice; otherwise full. The toggle saves its choice
// and rewrites ?layout= so a reload keeps it.
const LAYOUTS = ["full", "dock"];
const LAYOUT_LABEL = { full: "Full", dock: "Compact" };
const LAYOUT_KEY = "gentle-office.layout";
const layoutToggle = $("layoutToggle");

function storedLayout() {
	try {
		return localStorage.getItem(LAYOUT_KEY);
	} catch {
		return null;
	}
}

function initialLayout() {
	const fromUrl = new URLSearchParams(location.search).get("layout");
	if (LAYOUTS.includes(fromUrl)) return fromUrl;
	const saved = storedLayout();
	return LAYOUTS.includes(saved) ? saved : "full";
}

// The toggle shows the layout it switches to. CSS keys off <html data-layout>, so the grid refits on its own.
function applyLayout(layout, { remember }) {
	document.documentElement.dataset.layout = layout;
	const next = layout === "dock" ? "full" : "dock";
	layoutToggle.textContent = LAYOUT_LABEL[next];
	layoutToggle.setAttribute("aria-label", `Switch to the ${LAYOUT_LABEL[next].toLowerCase()} layout`);
	if (!remember) return;
	try {
		localStorage.setItem(LAYOUT_KEY, layout);
	} catch {
		// Storage can be blocked; the choice then lasts for this page only.
	}
	const url = new URL(location.href);
	url.searchParams.set("layout", layout);
	history.replaceState(null, "", url);
}

applyLayout(initialLayout(), { remember: false });
layoutToggle.addEventListener("click", () => {
	applyLayout(document.documentElement.dataset.layout === "dock" ? "full" : "dock", { remember: true });
});

// Integer-scale fit: the room is shown at the largest whole multiple (1x, 2x, 3x...) that fits the stage column and keeps the
// whole room on screen. Whole multiples keep the pixel art crisp; the scale never drops below 1x.
const mainEl = document.querySelector("main");
const asideEl = document.querySelector("aside");
const frameEl = canvas.parentElement;
let fittedScale = 0;

function fitCanvas() {
	const main = getComputedStyle(mainEl);
	const frame = getComputedStyle(frameEl);
	const num = (style, prop) => parseFloat(style[prop]) || 0;
	// Two grid tracks means the sidebar sits beside the stage; one track means it sits under it.
	const sideBySide = main.gridTemplateColumns.trim().split(/\s+/).length > 1;
	const roomW = mainEl.clientWidth - num(main, "paddingLeft") - num(main, "paddingRight")
		- (sideBySide ? asideEl.offsetWidth + num(main, "columnGap") : 0);
	const frameX = num(frame, "paddingLeft") + num(frame, "paddingRight") + num(frame, "borderLeftWidth") + num(frame, "borderRightWidth");
	// Height left for the canvas: viewport minus header, footer, main padding and everything else in the stage (frame chrome, legend).
	const stageRest = canvas.closest(".stage").offsetHeight - canvas.offsetHeight;
	const roomH = window.innerHeight - document.querySelector("header").offsetHeight - document.querySelector("footer").offsetHeight
		- num(main, "paddingTop") - num(main, "paddingBottom") - stageRest;
	const fits = Math.min(Math.floor((roomW - frameX) / canvas.width), Math.floor(roomH / canvas.height));
	const scale = Number.isFinite(fits) ? Math.max(1, fits) : 1;
	if (scale === fittedScale) return;
	fittedScale = scale;
	canvas.style.width = `${canvas.width * scale}px`;
	canvas.style.height = `${canvas.height * scale}px`;
}

// Refit on every page resize (window or stage). Queued to the next frame so the observer never fires mid-layout.
let fitQueued = false;
const queueFit = () => {
	if (fitQueued) return;
	fitQueued = true;
	requestAnimationFrame(() => {
		fitQueued = false;
		fitCanvas();
	});
};
fitCanvas();
new ResizeObserver(queueFit).observe(mainEl);

const stamp = (at) => (at > 0 ? new Date(at).toTimeString().slice(0, 8) : "--:--:--");

function orchestratorLabel(current) {
	if (current.brewing) return "brewing a fresh pot";
	switch (current.orchestrator) {
		case "thinking": return "planning on the whiteboard";
		case "tool": return "running a tool";
		case "waiting-user": return "waiting for you";
		default: return "idle on the floor";
	}
}

function renderStage() {
	const label = orchestratorLabel(view);
	if (label === lastLabel) return;
	lastLabel = label;
	const usage = view.percent === null ? "usage not reported yet" : `${view.percent} percent of context used`;
	const description = `Pixel-art office. The orchestrator is ${label}. ${usage}.`;
	canvas.setAttribute("aria-label", description);
	$("orchState").textContent = label;
	$("footState").textContent = view.orchestrator;
}

function renderBrew() {
	const left = view.percent === null ? null : 100 - view.percent;
	$("brewLeft").textContent = left === null ? "—" : `${left}%`;
	$("brewSub").textContent = left === null ? "context usage not reported yet" : "of the context window left";
	$("footCtx").textContent = `ctx ${view.percent === null ? "—" : `${view.percent}%`}`;
	const cups = Math.round(view.potLevel * 10);
	const cupEls = Array.from({ length: 10 }, (_, i) => {
		const cup = el("i", i < cups ? "" : "empty");
		return cup;
	});
	$("cups").replaceChildren(...cupEls);
	const note = $("brewNote");
	if (view.brewing) {
		note.textContent = "Compacting: the orchestrator is brewing a fresh pot.";
		note.className = "brew-note warn";
	} else if (view.percent !== null && view.potLevel < 0.15) {
		note.textContent = "Pot almost empty: compaction is coming.";
		note.className = "brew-note warn";
	} else {
		note.textContent = "The pot drains as context fills. Compaction brews a fresh one.";
		note.className = "brew-note";
	}
	$("agentCount").textContent = view.activeAgents === 0 ? "none running" : `${view.activeAgents} running`;
	$("footAgents").textContent = `${view.activeAgents} subagent${view.activeAgents === 1 ? "" : "s"}`;
}

// Team sidebar: one row per resident agent. Labels and statuses go in through textContent only.
function renderCrew() {
	const rows = view.agents.map((agent) => {
		const li = el("li");
		const dot = el("span", `dot role-${agent.role}`);
		const who = el("span", "who");
		const name = el("b");
		name.textContent = agent.label || ROLE_LABEL[agent.role];
		const status = el("small");
		status.textContent = `${ROLE_LABEL[agent.role]} · ${STATUS_LABEL[agent.status] ?? agent.status}`;
		who.append(name, status);
		li.append(dot, who);
		return li;
	});
	if (rows.length === 0) {
		const li = el("li", "plain");
		const who = el("span", "who");
		const name = el("b");
		name.textContent = "No resident agents";
		const hint = el("small");
		hint.textContent = "Explore, worker and verify agents take a desk while they run.";
		who.append(name, hint);
		li.append(who);
		rows.push(li);
	}
	crewEl.replaceChildren(...rows);
}

function renderLog() {
	// Prepend only the new lines so a polite live region announces what changed, not the whole list.
	const fresh = scene.log.filter((entry) => entry.id > seenLogId);
	if (fresh.length === 0) return;
	seenLogId = scene.log[0].id;
	for (const entry of fresh.slice().reverse()) {
		const li = el("li");
		const time = el("time");
		time.textContent = stamp(entry.at);
		const text = el("span", `k-${entry.kind}`);
		text.textContent = entry.text;
		li.append(time, text);
		logEl.prepend(li);
	}
	while (logEl.children.length > SCENE_LOG_LIMIT) logEl.lastElementChild.remove();
}

function dispatch(action) {
	const next = reduceScene(scene, action);
	if (next === scene) return;
	scene = next;
	view = sceneView(scene);
	engine.setScene(view);
	renderStage();
	renderBrew();
	renderCrew();
	renderLog();
}

const isText = (value) => typeof value === "string" && value !== "";

// ask_user dialog: shows the open prompt, display only. Text goes in through textContent.
function renderAsk(ask) {
	const questions = ask && Array.isArray(ask.questions) ? ask.questions.filter((q) => q && isText(q.question)) : [];
	if (questions.length === 0) {
		askEl.hidden = true;
		askEl.replaceChildren();
		return;
	}
	const blocks = questions.map((q) => {
		const block = el("div", "q");
		if (isText(q.header)) {
			const head = el("div", "head");
			head.textContent = q.multiSelect ? `${q.header} · pick any` : q.header;
			block.append(head);
		}
		const line = el("p");
		line.style.margin = "4px 0 0";
		const who = el("span", "who");
		who.textContent = "ORCHESTRATOR:";
		const text = el("span");
		text.textContent = q.question;
		line.append(who, text);
		block.append(line);
		const options = Array.isArray(q.options) ? q.options.filter(isText) : [];
		if (options.length > 0) {
			const list = el("ul");
			for (const option of options) {
				const item = el("li");
				item.textContent = option;
				list.append(item);
			}
			block.append(list);
		}
		return block;
	});
	const hint = el("div", "hint");
	hint.textContent = "Answer in the terminal.";
	const caret = el("span", "caret");
	caret.textContent = "▼";
	caret.setAttribute("aria-hidden", "true");
	askEl.replaceChildren(...blocks, hint, caret);
	askEl.hidden = false;
}

function setLive(text, state) {
	liveEl.textContent = text;
	liveEl.className = state === "live" ? "live" : `live ${state}`;
}

function parse(data) {
	try {
		return JSON.parse(data);
	} catch {
		return undefined;
	}
}

// EventSource reconnects by itself. Each new connection starts with a snapshot, so the scene resyncs on its own.
const source = new EventSource("events");
source.addEventListener("open", () => {
	setLive("live", "live");
	if (hasDropped) dispatch({ type: "note", kind: "info", text: "Reconnected: state re-synced", at: Date.now() });
});
source.addEventListener("snapshot", (message) => {
	const snapshot = parse(message.data);
	if (!snapshot) return;
	dispatch({ type: "snapshot", snapshot, at: Date.now() });
	renderAsk(snapshot.ask);
});
source.addEventListener("office", (message) => {
	const envelope = parse(message.data);
	if (!envelope) return;
	dispatch({ type: "event", seq: envelope.seq, event: envelope.event, at: Date.now() });
	if (envelope.event && envelope.event.type === "ask") renderAsk(envelope.event.phase === "open" ? envelope.event : null);
});
source.addEventListener("error", () => {
	hasDropped = true;
	if (source.readyState === EventSource.CLOSED) setLive("offline: run /office open again", "bad");
	else setLive("reconnecting…", "warn");
});

renderStage();
renderBrew();
renderCrew();
