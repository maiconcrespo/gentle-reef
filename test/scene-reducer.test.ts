import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Plain ES module shared with the browser page (web/); no build step, so Node loads it directly.
import { SCENE_LOG_LIMIT, initialScene, reduceScene, sceneView } from "../web/scene-reducer.js";
// Feature helpers are read through the namespace so the rest of this file still runs while they are missing.
import * as reducer from "../web/scene-reducer.js";

type Scene = ReturnType<typeof initialScene>;

const at = 1_000;
const event = (body: Record<string, unknown>) => ({ type: "event", seq: 1, at, event: { v: 1, ...body } });
const orchestrator = (state: string, toolName?: string) => event({ type: "orchestrator", state, ...(toolName ? { toolName } : {}) });
const context = (percent: number | null) => event({ type: "context", percent });
const compaction = (phase: string) => event({ type: "compaction", phase });

function run(...actions: unknown[]): Scene {
	return actions.reduce<Scene>((state, action) => reduceScene(state, action as never), initialScene());
}

describe("orchestrator state maps to where the orchestrator is", () => {
	it("thinking writes on the whiteboard", () => {
		const view = sceneView(run(orchestrator("thinking")));
		assert.equal(view.intent, "whiteboard");
		assert.equal(view.writing, true);
		assert.equal(view.bubble, "idea");
	});

	it("tool runs on the whiteboard with a wrench bubble", () => {
		const view = sceneView(run(orchestrator("tool", "bash")));
		assert.equal(view.intent, "whiteboard");
		assert.equal(view.writing, true);
		assert.equal(view.bubble, "wrench");
	});

	it("idle walks the floor and writes nothing", () => {
		const view = sceneView(run(orchestrator("thinking"), orchestrator("idle")));
		assert.equal(view.intent, "floor");
		assert.equal(view.writing, false);
		assert.equal(view.bubble, null);
	});

	it("waiting-user goes to the front with a question bubble and logs the ask", () => {
		const state = run(orchestrator("waiting-user"));
		const view = sceneView(state);
		assert.equal(view.intent, "front");
		assert.equal(view.bubble, "question");
		assert.equal(state.log[0].kind, "ask");
	});
});

describe("context drives the coffee pot", () => {
	it("pot level is 1 - percent/100", () => {
		assert.equal(sceneView(run(context(40))).potLevel, 0.6);
		assert.equal(sceneView(run(context(0))).potLevel, 1);
		assert.equal(sceneView(run(context(100))).potLevel, 0);
	});

	it("unknown usage keeps a full pot and reports no percent", () => {
		const view = sceneView(run(context(null)));
		assert.equal(view.percent, null);
		assert.equal(view.potLevel, 1);
	});

	it("rejects readings outside 0..100 and non-numbers without changing the pot", () => {
		for (const bad of [150, -1, Number.NaN, "40"]) {
			const state = run(context(40), context(bad as number));
			assert.equal(sceneView(state).percent, 40, `reading ${String(bad)} must be ignored`);
		}
	});
});

describe("compaction brews a fresh pot", () => {
	it("start walks the orchestrator to the coffee machine and starts brewing", () => {
		const view = sceneView(run(orchestrator("thinking"), context(40), compaction("start")));
		assert.equal(view.intent, "coffee");
		assert.equal(view.brewing, true);
		assert.equal(view.bubble, "cup");
		assert.equal(view.potLevel, 0.6, "the pot keeps draining until the refill");
	});

	it("end stops brewing, refills the pot and returns the orchestrator to its state", () => {
		const view = sceneView(run(orchestrator("thinking"), context(90), compaction("start"), compaction("end")));
		assert.equal(view.brewing, false);
		assert.equal(view.intent, "whiteboard");
		assert.equal(view.potLevel, 1, "a fresh pot is full until the next usage reading");
		assert.equal(view.percent, null);
	});

	it("end while idle returns the orchestrator to the floor", () => {
		assert.equal(sceneView(run(orchestrator("idle"), compaction("start"), compaction("end"))).intent, "floor");
	});

	it("compaction wins over waiting-user and the front returns after it ends", () => {
		const during = sceneView(run(orchestrator("waiting-user"), compaction("start")));
		assert.equal(during.intent, "coffee");
		const after = sceneView(run(orchestrator("waiting-user"), compaction("start"), compaction("end")));
		assert.equal(after.intent, "front");
	});

	it("failed stops brewing and keeps the pot as it was", () => {
		const state = run(context(40), compaction("start"), compaction("failed"));
		const view = sceneView(state);
		assert.equal(view.brewing, false);
		assert.equal(view.potLevel, 0.6);
		assert.equal(state.log[0].kind, "fail");
	});
});

describe("events and snapshot", () => {
	it("a snapshot taken mid-compaction starts the brew right away", () => {
		const state = reduceScene(initialScene(), {
			type: "snapshot",
			at,
			snapshot: { v: 1, orchestrator: { state: "tool", toolName: "bash" }, context: { percent: 25 }, compaction: "start", agents: [] },
		});
		const view = sceneView(state);
		assert.equal(view.brewing, true);
		assert.equal(view.intent, "coffee");
		assert.equal(view.potLevel, 0.75);
	});

	it("a snapshot replaces the state a reconnect would otherwise leave stale", () => {
		const stale = run(context(90), orchestrator("tool", "bash"));
		const state = reduceScene(stale, { type: "snapshot", at, snapshot: { v: 1, orchestrator: { state: "idle" }, context: { percent: 10 }, compaction: null, agents: [] } });
		const view = sceneView(state);
		assert.equal(view.intent, "floor");
		assert.equal(view.potLevel, 0.9);
	});

	it("a tool writes one activity line when it ends, with its duration", () => {
		const tool = (phase: string, when: number, ok?: boolean) =>
			({ type: "event", seq: 1, at: when, event: { v: 1, type: "tool", actor: "orchestrator", toolName: "bash", phase, ...(ok === undefined ? {} : { ok }) } });
		const started = run(tool("start", 1_000));
		assert.deepEqual(started.log, []);
		const ended = run(tool("start", 1_000), tool("end", 1_420, true));
		assert.equal(ended.log.length, 1);
		assert.deepEqual({ kind: ended.log[0].kind, text: ended.log[0].text }, { kind: "tool", text: "bash · 0.4s" });
		const failed = run(tool("start", 1_000), tool("end", 13_600, false));
		assert.deepEqual({ kind: failed.log[0].kind, text: failed.log[0].text }, { kind: "fail", text: "bash failed · 13s" });
		assert.equal(run(tool("start", 0), tool("end", 65_000, true)).log[0].text, "bash · 1m 05s");
		// An end without a seen start (for example after a reconnect) has no duration.
		assert.equal(run(tool("end", 1_000, true)).log[0].text, "bash finished");
		assert.equal(run(tool("end", 1_000, false)).log[0].text, "bash failed");
	});

	it("the view rounds the context percent to a whole number; the pot keeps the exact level", () => {
		const view = sceneView(run(context(8.8967)));
		assert.equal(view.percent, 9);
		assert.equal(view.potLevel, 0.911);
	});

	it("feature events are logged but do not move the scene", () => {
		const before = sceneView(run(orchestrator("idle")));
		const state = run(orchestrator("idle"), event({ type: "feature", feature: "memory", detail: "mem_search" }));
		const { features: _lit, ...rest } = sceneView(state);
		const { features: _before, ...restBefore } = before;
		assert.deepEqual(rest, restBefore);
		assert.equal(state.log[0].text, "memory: mem_search");
	});

	it("subagent events feed the active agent count until they finish", () => {
		const running = event({ type: "subagent", id: "t1", agent: "worker", role: "worker", label: "job", status: "running" });
		const done = event({ type: "subagent", id: "t1", agent: "worker", role: "worker", label: "job", status: "completed" });
		assert.equal(sceneView(run(running)).activeAgents, 1);
		assert.equal(sceneView(run(running, done)).activeAgents, 0);
	});

	it("ignores envelopes with another contract version or an unknown type", () => {
		const start = run(orchestrator("tool", "bash"));
		assert.deepEqual(reduceScene(start, { type: "event", seq: 2, at, event: { v: 2, type: "orchestrator", state: "idle" } }), start);
		assert.deepEqual(reduceScene(start, { type: "event", seq: 3, at, event: { v: 1, type: "mystery" } }), start);
		assert.deepEqual(reduceScene(start, { type: "snapshot", at, snapshot: { v: 2 } }), start);
	});

	it("keeps only the newest log lines, newest first", () => {
		let state = initialScene();
		for (let i = 0; i < SCENE_LOG_LIMIT + 10; i++) {
			state = reduceScene(state, { type: "event", seq: i + 1, at, event: { v: 1, type: "feature", feature: "web", detail: `q${i}` } });
		}
		assert.equal(state.log.length, SCENE_LOG_LIMIT);
		assert.equal(state.log[0].text, `web: q${SCENE_LOG_LIMIT + 9}`);
	});

	it("notes from the page (connection changes) go into the log", () => {
		const state = reduceScene(initialScene(), { type: "note", kind: "info", text: "Reconnected", at });
		assert.equal(state.log[0].text, "Reconnected");
		assert.equal(state.log[0].at, at);
	});
});

describe("feature props light while their feature is active", () => {
	const FEATURES = ["music", "design", "memory", "web", "todo", "ask", "mcp", "codegraph"];
	const featureAt = (when: number, feature: string, detail: string) =>
		({ type: "event", seq: 1, at: when, event: { v: 1, type: "feature", feature, detail } });
	const toolAt = (when: number, phase: "start" | "end", toolName: string) =>
		({ type: "event", seq: 1, at: when, event: { v: 1, type: "tool", actor: "orchestrator", toolName, phase, ok: true } });
	const litAt = (state: Scene, feature: string, now: number) =>
		reducer.featureActive(sceneView(state).features[feature as keyof ReturnType<typeof sceneView>["features"]], now);

	it("every prop feature is idle before any event", () => {
		for (const feature of FEATURES) assert.equal(litAt(initialScene(), feature, at), false, feature);
	});

	it("a finished tool lights its prop for the linger time, then the prop expires to idle", () => {
		// Real order: the feature event comes with the tool start, and the tool end comes later.
		const state = run(featureAt(at, "memory", "mem_search"), toolAt(at, "start", "mem_search"), toolAt(at + 1_000, "end", "mem_search"));
		assert.equal(litAt(state, "memory", at + 1_000 + reducer.FEATURE_LINGER_MS - 1), true);
		assert.equal(litAt(state, "memory", at + 1_000 + reducer.FEATURE_LINGER_MS), false);
	});

	it("only the prop of the event's feature lights", () => {
		const state = run(featureAt(at, "memory", "mem_search"));
		for (const other of FEATURES.filter(feature => feature !== "memory")) assert.equal(litAt(state, other, at), false, other);
	});

	it("a running tool keeps its prop lit past the linger time, and it lingers again after the end", () => {
		const running = run(featureAt(at, "web", "web_search"), toolAt(at, "start", "web_search"));
		assert.equal(litAt(running, "web", at + 60_000), true, "still running");
		const ended = reduceScene(running, toolAt(at + 60_000, "end", "web_search"));
		assert.equal(litAt(ended, "web", at + 60_000 + reducer.FEATURE_LINGER_MS - 1), true, "lingers after the end");
		assert.equal(litAt(ended, "web", at + 60_000 + reducer.FEATURE_LINGER_MS), false);
	});

	it("a feature stays lit until every one of its running tools has ended", () => {
		const state = run(
			featureAt(at, "memory", "mem_search"), toolAt(at, "start", "mem_search"),
			featureAt(at, "memory", "mem_save"), toolAt(at, "start", "mem_save"),
			toolAt(at + 1_000, "end", "mem_search"),
		);
		assert.equal(litAt(state, "memory", at + 60_000), true, "mem_save is still running");
	});

	it("a snapshot that no longer reports a running tool clears its activity", () => {
		const running = run(featureAt(at, "ask", "ask_user_question"), toolAt(at, "start", "ask_user_question"));
		const snapped = reduceScene(running, { type: "snapshot", at: at + 5_000, snapshot: { v: 1, orchestrator: { state: "idle" }, context: { percent: null }, compaction: null, agents: [] } });
		assert.equal(litAt(snapped, "ask", at + 5_000), false);
	});
});

describe("lounge staff and the team view (S16)", () => {
	const subagent = (id: string, role: string, status: string) => event({ type: "subagent", id, agent: `gentle-ai-${role}`, role, label: "job", status });

	it("staff start in the lounge, one per role", () => {
		assert.deepEqual(sceneView(initialScene()).staff, [
			{ role: "explore", present: true, claimedBy: null },
			{ role: "worker", present: true, claimedBy: null },
			{ role: "verify", present: true, claimedBy: null },
		]);
	});

	it("the team view lists idle staff as on break, after the residents", () => {
		assert.deepEqual(reducer.teamRows(sceneView(initialScene())), [
			{ kind: "staff", role: "explore", status: "on break" },
			{ kind: "staff", role: "worker", status: "on break" },
			{ kind: "staff", role: "verify", status: "on break" },
		]);
	});

	it("a claimed staff member is a resident row; the others stay on break", () => {
		const rows = reducer.teamRows(sceneView(run(subagent("t1", "explore", "running"))));
		assert.deepEqual(rows, [
			{ kind: "resident", id: "t1", role: "explore", label: "job", status: "running" },
			{ kind: "staff", role: "worker", status: "on break" },
			{ kind: "staff", role: "verify", status: "on break" },
		]);
	});
});
