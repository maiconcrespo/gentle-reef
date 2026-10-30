// Gentle Office page: connects the SSE stream to the scene reducer, the narrator, the canvas engine and the sidebar.
// Everything from the stream goes in through textContent, never innerHTML.
import {
	dwellMs,
	SCENE_LOG_LIMIT,
	actorOf,
	dialogView,
	initialDialog,
	initialNarrator,
	initialScene,
	narrate,
	narrateSnapshot,
	reduceDialog,
	reduceScene,
	sceneView,
	teamRows,
	typedLength,
} from "./scene-reducer.js";
import { OFFICE_CONFIG, createOfficeEngine, drawPot, storyZoom } from "./office-engine.js";

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
const frameEl = canvas.parentElement;
const sayEl = $("narration");
const sayWho = $("sayWho");
const sayText = $("sayText");
const sayCaret = $("sayCaret");
const captionEl = $("caption");
const capWho = $("capWho");
const capText = $("capText");

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

let scene = initialScene(OFFICE_CONFIG.desks.length, OFFICE_CONFIG.verifyDesks.length);
let view = sceneView(scene);
let seenLogId = 0;
let lastLabel = "";
let hasDropped = false;

// Narration: the narrator turns events into lines, the dialog box pages them. The box and the caption both read `dialog`.
let narrator = initialNarrator();
let dialog = initialDialog();
// Typewriter and auto-advance clocks for the line on screen (page time, never inside the pure modules).
let typedId = -1;
let typeStart = 0;
let finishedId = -1;
let finishedAt = 0;
// The actor the story camera is on: the orchestrator until an event says otherwise.
let follow = { kind: "orchestrator" };
// Story camera size, set by fitStory: the engine gets it again whenever the followed actor changes.
let storyFrame = null;
// Compact/full when the room is wider than the column even at 1x (S17 wide room): a 1x view that pans with the action.
let roomView = null;

const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
let reduced = reducedQuery.matches;
reducedQuery.addEventListener("change", (event) => { reduced = event.matches; });

const engine = createOfficeEngine(canvas, OFFICE_CONFIG, {
	onPot: ({ level, brewing, time }) => drawPot(potCtx, level, time, brewing),
	// An agent has walked out of the door: its seat frees up for the next one in the bench.
	onDeparted: (id) => dispatch({ type: "departed", id }),
});

// Layout: "full" is the desk window, "dock" the narrow pane (design/agent-office/02-dock-pane.html), "story" the close-up
// that fills the window (design/agent-office/03-story-mode.html). ?layout= wins for this load (the /office menu entries use it);
// otherwise the saved choice; otherwise full. The header switch saves its choice and rewrites ?layout= so a reload keeps it.
const LAYOUTS = ["full", "dock", "story"];
const LAYOUT_KEY = "gentle-office.layout";
const layoutButtons = Array.from(document.querySelectorAll(".layout-switch button"));
const isStory = () => document.documentElement.dataset.layout === "story";

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

// CSS keys off <html data-layout>, so the grid refits on its own. The pressed button is the layout on screen.
function applyLayout(layout, { remember }) {
	document.documentElement.dataset.layout = layout;
	for (const button of layoutButtons) button.setAttribute("aria-pressed", String(button.dataset.layout === layout));
	// Only the story layout has a camera. Full and compact go back to the room's own size, and refit even at the same scale.
	if (layout !== "story") {
		engine.setCamera(null);
		fitKey = "";
	}
	fitCanvas();
	renderNarration();
	renderParty();
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

for (const button of layoutButtons) {
	button.addEventListener("click", () => applyLayout(button.dataset.layout, { remember: true }));
}

// Integer-scale fit for full and compact: the room is shown at the largest whole multiple (1x, 2x, 3x...) that fits the stage
// column and keeps the whole room on screen. Whole multiples keep the pixel art crisp. When even 1x is wider than the column
// (the wide room of S17 in a narrow dock), the room is shown at 1x through a camera that pans to follow the action.
// Full fits the width only (S17): the cards sit below the stage and the page scrolls, so height never caps it. Compact is a
// single column in a window of its own height, so it keeps the height cap.
const mainEl = document.querySelector("main");
let fitKey = "";

function fitCanvas() {
	if (isStory()) return fitStory();
	const main = getComputedStyle(mainEl);
	const frame = getComputedStyle(frameEl);
	const num = (style, prop) => parseFloat(style[prop]) || 0;
	const roomW = mainEl.clientWidth - num(main, "paddingLeft") - num(main, "paddingRight");
	const frameX = num(frame, "paddingLeft") + num(frame, "paddingRight") + num(frame, "borderLeftWidth") + num(frame, "borderRightWidth");
	const capsHeight = document.documentElement.dataset.layout === "dock";
	let maxH = Infinity;
	if (capsHeight) {
		// Height left for the canvas: viewport minus header, footer, main padding and the rest of the stage (frame chrome, caption).
		// The legend is left out: it may scroll below the fold rather than shrink the room to 1x.
		const legend = document.querySelector(".map");
		const legendH = legend && legend.offsetParent !== null ? legend.offsetHeight + num(getComputedStyle(canvas.closest(".stage")), "rowGap") : 0;
		const stageRest = canvas.closest(".stage").offsetHeight - canvas.offsetHeight - legendH;
		maxH = window.innerHeight - document.querySelector("header").offsetHeight - document.querySelector("footer").offsetHeight
			- num(main, "paddingTop") - num(main, "paddingBottom") - stageRest;
	}
	const roomPxW = OFFICE_CONFIG.cols * OFFICE_CONFIG.tile, roomPxH = OFFICE_CONFIG.rows * OFFICE_CONFIG.tile;
	const columnW = roomW - frameX;
	const whole = Math.min(Math.floor(columnW / roomPxW), Math.floor(maxH / roomPxH));
	const panned = whole < 1;
	const roomH = Math.min(roomPxH, maxH);
	const key = panned ? `pan:${Math.floor(columnW)}x${Math.floor(roomH)}` : `room:${whole}`;
	if (key === fitKey) return;
	fitKey = key;
	if (panned) {
		roomView = { zoom: 1, width: Math.max(1, Math.min(roomPxW, Math.floor(columnW))), height: Math.max(1, Math.floor(roomH)) };
		pushCamera();
		canvas.style.width = `${roomView.width}px`;
		canvas.style.height = `${roomView.height}px`;
		return;
	}
	roomView = null;
	engine.setCamera(null);
	canvas.style.width = `${roomPxW * whole}px`;
	canvas.style.height = `${roomPxH * whole}px`;
}

// Story: the canvas fills the frame at a whole-number zoom. The frame is the whole main area, so its size is the window's.
function fitStory() {
	const width = Math.max(1, Math.floor(frameEl.clientWidth));
	const height = Math.max(1, Math.floor(frameEl.clientHeight));
	const key = `story:${width}x${height}`;
	if (key === fitKey) return;
	fitKey = key;
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	storyFrame = { zoom: storyZoom(width, height), width, height };
	pushCamera();
}

function pushCamera() {
	if (isStory() && storyFrame) engine.setCamera({ ...storyFrame, target: follow });
	else if (roomView) engine.setCamera({ ...roomView, target: follow });
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
new ResizeObserver(queueFit).observe(mainEl);

// The story camera follows whoever acted last. The party list marks the same actor.
function setFollow(actor) {
	follow = actor;
	if (isStory() || roomView) pushCamera();
	renderParty();
}

const stamp = (at) => (at > 0 ? new Date(at).toTimeString().slice(0, 8) : "--:--:--");

// Writes text only when it changes, so the per-frame typewriter does not churn the DOM.
const setText = (node, text) => {
	if (node.textContent !== text) node.textContent = text;
};

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
	// Story brew box: the same rounded percent as an HP bar (fill = what is left).
	$("sBrewNum").textContent = left === null ? "—" : `${left}%`;
	$("sBrewSub").textContent = left === null ? "context usage not reported yet" : "of the context window left";
	$("sBrewFill").style.width = left === null ? "0%" : `${left}%`;
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

// Team sidebar: the residents, then each idle staff member on break (S16). Labels and statuses go in through textContent only.
function renderCrew() {
	const rows = teamRows(view).map((row) => {
		const staff = row.kind === "staff";
		const li = el("li", staff ? "on-break" : "");
		const dot = el("span", `dot role-${row.role}`);
		const who = el("span", "who");
		const name = el("b");
		name.textContent = staff ? ROLE_LABEL[row.role] : row.label || ROLE_LABEL[row.role];
		const status = el("small");
		status.textContent = staff ? row.status : `${ROLE_LABEL[row.role]} · ${STATUS_LABEL[row.status] ?? row.status}`;
		who.append(name, status);
		li.append(dot, who);
		return li;
	});
	crewEl.replaceChildren(...rows);
}

// Story party box: the orchestrator, then each resident with its state. The row the camera follows is marked.
function renderParty() {
	const rows = [
		partyRow("orchestrator", "Orchestrator", orchestratorLabel(view), follow.kind === "orchestrator"),
		...teamRows(view).map((row) => {
			if (row.kind === "staff") {
				const li = partyRow(row.role, ROLE_LABEL[row.role], row.status, false);
				li.className = "on-break";
				return li;
			}
			return partyRow(
				row.role,
				row.label || ROLE_LABEL[row.role],
				`${ROLE_LABEL[row.role]} · ${STATUS_LABEL[row.status] ?? row.status}`,
				follow.kind === "resident" && follow.id === row.id,
			);
		}),
	];
	$("sParty").replaceChildren(...rows);
}

function partyRow(role, name, state, current) {
	const li = el("li");
	if (current) li.setAttribute("aria-current", "true");
	const dot = el("span", `dot role-${role}`);
	const who = el("span", "who");
	const label = el("b");
	label.textContent = name;
	const status = el("small");
	status.textContent = state;
	who.append(label, status);
	li.append(dot, who);
	return li;
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
	renderParty();
	renderLog();
}

const isText = (value) => typeof value === "string" && value !== "";

// ask_user dialog: shows the open prompt, display only. Text goes in through textContent. Returns whether a prompt is open.
function renderAsk(ask) {
	const questions = ask && Array.isArray(ask.questions) ? ask.questions.filter((q) => q && isText(q.question)) : [];
	if (questions.length === 0) {
		askEl.hidden = true;
		askEl.replaceChildren();
		return false;
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
	return true;
}

// Narration: the dialog queue advances through the reducer; the box and the caption render what it holds.
function dispatchDialog(action) {
	dialog = reduceDialog(dialog, action);
	renderNarration();
}

function narrateEvent(event, at) {
	// Read after the scene took the event, so a finishing claimant still holds its staff member and narrates the walk back.
	const claimant = event && event.type === "subagent" && view.agents.some((agent) => agent.id === event.id && agent.claimed);
	const result = narrate(narrator, event, at, { claimant: Boolean(claimant) });
	narrator = result.state;
	if (result.lines.length > 0) dispatchDialog({ type: "lines", lines: result.lines });
}

/**
 * Renders the dialog. Story: the line types out in the big box, a finished line waits dwellMs (AUTO_ADVANCE_MS, less when lines back up) and then the next
 * queued line takes the box. An open ask prompt holds the box, so narration pauses behind it. Full and compact: the
 * current line is a one-line caption under the room.
 */
function renderNarration() {
	const current = dialogView(dialog);
	const line = current.line;
	const story = isStory();
	captionEl.hidden = story || !line;
	if (line) {
		setText(capWho, `${line.speaker}:`);
		setText(capText, line.text);
		captionEl.dataset.tone = line.tone;
	}
	sayEl.hidden = !story || current.mode !== "line";
	if (current.mode !== "line") return;
	const now = Date.now();
	if (line.id !== typedId) {
		typedId = line.id;
		typeStart = now;
	}
	const shown = typedLength(line.text, now - typeStart, reduced);
	setText(sayWho, `${line.speaker}:`);
	setText(sayText, line.text.slice(0, shown));
	sayEl.dataset.tone = line.tone;
	const finished = shown >= line.text.length;
	sayCaret.hidden = !finished;
	if (finished && finishedId !== line.id) {
		finishedId = line.id;
		finishedAt = now;
	}
	if (finished && current.pending > 0 && now - finishedAt >= dwellMs(current.pending)) dispatchDialog({ type: "next" });
}

// Space or a click on the frame: finish the typewriter if it runs, otherwise move on to the next queued line.
function skipLine() {
	if (!isStory()) return;
	const current = dialogView(dialog);
	if (current.mode !== "line") return;
	const line = current.line;
	const typing = line.id === typedId && typedLength(line.text, Date.now() - typeStart, reduced) < line.text.length;
	if (typing) typeStart = -Infinity;
	else if (current.pending > 0) dispatchDialog({ type: "next" });
	renderNarration();
}

frameEl.addEventListener("click", skipLine);
document.addEventListener("keydown", (event) => {
	// Buttons keep their own Space behaviour (the layout switch); everywhere else Space moves the dialog on.
	if (event.key !== " " || !isStory() || event.target instanceof HTMLButtonElement) return;
	event.preventDefault();
	skipLine();
});

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
	// A snapshot is what the page already knows after a reconnect: it sets the narrator's memory without new lines.
	narrator = narrateSnapshot(narrator, snapshot);
	dispatchDialog({ type: "ask", open: renderAsk(snapshot.ask) });
});
source.addEventListener("office", (message) => {
	const envelope = parse(message.data);
	if (!envelope) return;
	const at = Date.now();
	dispatch({ type: "event", seq: envelope.seq, event: envelope.event, at });
	const actor = actorOf(envelope.event);
	if (actor) setFollow(actor);
	narrateEvent(envelope.event, at);
	if (envelope.event && envelope.event.type === "ask") {
		const open = renderAsk(envelope.event.phase === "open" ? envelope.event : null);
		dispatchDialog({ type: "ask", open });
	}
});
source.addEventListener("error", () => {
	hasDropped = true;
	if (source.readyState === EventSource.CLOSED) setLive("offline: run /office open again", "bad");
	else setLive("reconnecting…", "warn");
});

// The typewriter and the auto advance run once per frame; each call only touches the DOM when something changed.
function narrationFrame() {
	renderNarration();
	requestAnimationFrame(narrationFrame);
}

renderStage();
renderBrew();
renderCrew();
renderParty();
applyLayout(initialLayout(), { remember: false });
requestAnimationFrame(narrationFrame);
