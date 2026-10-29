import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
// Browser module, loaded as-is. The canvas and frame loop are stubbed below; the engine is driven frame by frame.
import { OFFICE_CONFIG, createOfficeEngine } from "../web/office-engine.js";

// A 2D context that accepts any call and any property write.
const fakeContext = (): Record<string, unknown> =>
	new Proxy({} as Record<string, unknown>, {
		get: (target, key) => (key in target ? target[key as string] : () => undefined),
		set: (target, key, value) => { target[key as string] = value; return true; },
	});
const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => fakeContext() });

const g = globalThis as Record<string, unknown>;
let frames: Array<(now: number) => void> = [];
let clock = 0;
let reduced = false;

beforeEach(() => {
	frames = [];
	reduced = false;
	clock = performance.now();
	g.document = { createElement: () => fakeCanvas() };
	g.matchMedia = () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} });
	g.requestAnimationFrame = (fn: (now: number) => void) => { frames.push(fn); return frames.length; };
});

afterEach(() => {
	delete g.document;
	delete g.matchMedia;
	delete g.requestAnimationFrame;
});

/** Runs `seconds` of frames at 60 fps. */
function run(seconds: number): void {
	for (let i = 0; i < Math.round(seconds * 60); i++) {
		clock += 1000 / 60;
		const pending = frames;
		frames = [];
		for (const frame of pending) frame(clock);
	}
}

const seat = (zone: "desk" | "bench", index: number) => ({ zone, index });
const resident = (id: string, where: { zone: "desk" | "bench"; index: number }, status: string, instant = false) => ({
	id,
	agent: "gentle-ai-worker",
	role: "worker",
	label: id,
	status,
	seat: where,
	leaving: !["queued", "running", "waiting"].includes(status),
	instant,
});
const view = (agents: unknown[]) => ({
	intent: "floor", writing: false, bubble: null, brewing: false, orchestrator: "idle",
	percent: null, potLevel: 1, activeAgents: 0, agents,
});

describe("resident sprites in the engine", () => {
	it("a finished agent reports departure once, after its bubble delay and its walk out", () => {
		const departed: string[] = [];
		const engine = createOfficeEngine({ width: 0, height: 0, getContext: () => fakeContext() }, OFFICE_CONFIG, { onDeparted: (id: string) => departed.push(id) });
		engine.setScene(view([resident("t1", seat("desk", 0), "running")]));
		run(12);
		assert.deepEqual(departed, [], "a running agent stays");
		engine.setScene(view([resident("t1", seat("desk", 0), "completed")]));
		run(1);
		assert.deepEqual(departed, [], "the check bubble shows before the agent walks out");
		run(30);
		assert.deepEqual(departed, ["t1"]);
		run(5);
		assert.deepEqual(departed, ["t1"], "departure is reported once");
		engine.destroy();
	});

	it("under reduced motion a finished agent leaves after the bubble delay without walking", () => {
		reduced = true;
		const departed: string[] = [];
		const engine = createOfficeEngine({ width: 0, height: 0, getContext: () => fakeContext() }, OFFICE_CONFIG, { onDeparted: (id: string) => departed.push(id) });
		engine.setScene(view([resident("t1", seat("desk", 1), "running", true)]));
		engine.setScene(view([resident("t1", seat("desk", 1), "failed")]));
		run(1);
		assert.deepEqual(departed, []);
		run(1.5);
		assert.deepEqual(departed, ["t1"], "snapped to the door once the bubble delay passed");
		engine.destroy();
	});

	it("queued agents on the bench and a full desk row render without errors and leave in order", () => {
		const departed: string[] = [];
		const engine = createOfficeEngine({ width: 0, height: 0, getContext: () => fakeContext() }, OFFICE_CONFIG, { onDeparted: (id: string) => departed.push(id) });
		const agents = [
			resident("d0", seat("desk", 0), "running", true),
			resident("d1", seat("desk", 1), "running", true),
			resident("d2", seat("desk", 2), "waiting", true),
			resident("d3", seat("desk", 3), "running", true),
			...Array.from({ length: 8 }, (_, i) => resident(`b${i}`, seat("bench", i), "queued")),
		];
		assert.doesNotThrow(() => { engine.setScene(view(agents)); run(20); });
		engine.setScene(view(agents.map(a => (a.id === "d2" ? { ...a, status: "cancelled", leaving: true } : a))));
		run(40);
		assert.deepEqual(departed, ["d2"]);
		engine.destroy();
	});

	it("destroy stops the frame loop", () => {
		const departed: string[] = [];
		const engine = createOfficeEngine({ width: 0, height: 0, getContext: () => fakeContext() }, OFFICE_CONFIG, { onDeparted: (id: string) => departed.push(id) });
		engine.setScene(view([resident("t1", seat("desk", 0), "completed")]));
		engine.destroy();
		run(10);
		assert.deepEqual(departed, []);
	});
});
