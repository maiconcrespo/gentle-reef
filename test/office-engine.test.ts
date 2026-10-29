import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
// Browser module, loaded as-is. The canvas and frame loop are stubbed below; the engine is driven frame by frame.
import { HEAD_MAPS, OFFICE_CONFIG, SPRITE, createOfficeEngine } from "../web/office-engine.js";
// Feature props are read through the namespace so the rest of this file still runs while they are missing.
import * as engineModule from "../web/office-engine.js";

// A 2D context that accepts any call and any property write.
const fakeContext = (): Record<string, unknown> =>
	new Proxy({} as Record<string, unknown>, {
		get: (target, key) => (key in target ? target[key as string] : () => undefined),
		set: (target, key, value) => { target[key as string] = value; return true; },
	});
const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => fakeContext() });

// A 2D context that records every fillRect call on the on-screen canvas.
const recordingContext = (rects: number[][]): Record<string, unknown> =>
	new Proxy({} as Record<string, unknown>, {
		get: (target, key) => {
			if (key === "fillRect") return (...args: number[]) => { rects.push(args); };
			return key in target ? target[key as string] : () => undefined;
		},
		set: (target, key, value) => { target[key as string] = value; return true; },
	});

// Like recordingContext, but each rectangle also carries the fill colour it was drawn with.
const styledContext = (rects: unknown[][]): Record<string, unknown> =>
	new Proxy({} as Record<string, unknown>, {
		get: (target, key) => {
			if (key === "fillRect") return (...args: number[]) => { rects.push([...args, target.fillStyle]); };
			return key in target ? target[key as string] : () => undefined;
		},
		set: (target, key, value) => { target[key as string] = value; return true; },
	});

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
const view = (agents: unknown[], features: Record<string, unknown> = {}) => ({
	intent: "floor", writing: false, bubble: null, brewing: false, orchestrator: "idle",
	percent: null, potLevel: 1, activeAgents: 0, agents, features,
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

describe("sprite size", () => {
	it("draws 24x36 figures whose head maps are 24 columns by 14 rows", () => {
		assert.deepEqual(SPRITE, { w: 24, h: 36, head: 14 });
		for (const [name, rows] of Object.entries(HEAD_MAPS)) {
			assert.equal(rows.length, SPRITE.head, `${name} head rows`);
			for (const row of rows) assert.equal(row.length, SPRITE.w, `${name} head row width`);
		}
	});

	it("a resident walking in from the door draws only finite rectangles", () => {
		// The first animation frame can arrive before the engine's start time; a negative step once turned walkers into NaN.
		const rects: number[][] = [];
		const engine = createOfficeEngine({ width: 0, height: 0, getContext: () => recordingContext(rects) }, OFFICE_CONFIG);
		engine.setScene(view([resident("t1", seat("desk", 0), "running"), resident("t2", seat("bench", 0), "queued")]));
		// Deliver the first frame stamped before the engine started, as a browser can.
		const first = frames;
		frames = [];
		for (const frame of first) frame(performance.now() - 1000);
		run(3);
		engine.destroy();
		assert.ok(rects.length > 0);
		assert.ok(rects.every(args => args.every(Number.isFinite)), "no drawn rectangle has a NaN coordinate");
	});
});

describe("desk chairs and bench queue", () => {
	it("queued bubbles on the bench sit below every desk chair", () => {
		const rects: number[][] = [];
		const engine = createOfficeEngine({ width: 0, height: 0, getContext: () => recordingContext(rects) }, OFFICE_CONFIG);
		engine.setScene(view(Array.from({ length: 6 }, (_, i) => resident(`b${i}`, seat("bench", i), "queued", true))));
		run(1);
		rects.length = 0;
		run(1 / 60);
		engine.destroy();
		// A bubble is an 18x14 box. A chair ends 13 px under its desk's bottom edge (see drawChair).
		const bubbles = rects.filter(([, , w, h]) => w === 18 && h === 14);
		const lowestChair = Math.max(...OFFICE_CONFIG.desks.map(d => (d.y + 1) * OFFICE_CONFIG.tile + 13));
		assert.equal(bubbles.length, 6, "one queue bubble per queued agent");
		for (const [, y] of bubbles) assert.ok(y > lowestChair, `bubble top ${y} clears the chairs, which end at ${lowestChair}`);
	});
});

describe("feature props", () => {
	const FEATURES = ["music", "design", "memory", "web", "todo", "ask", "mcp", "codegraph"];
	type Prop = { feature: string; x: number; y: number; w: number; h: number };
	const props = (): Prop[] => (engineModule as unknown as { FEATURE_PROPS: Prop[] }).FEATURE_PROPS;
	const active = (feature: string) => ({ [feature]: { running: true, until: 0 } });

	/** Walkable-area check: breadth-first search over the grid the engine walks (true = blocked). */
	function reachableFrom(block: boolean[][], from: [number, number]): Set<string> {
		const seen = new Set<string>([from.join(",")]);
		const queue: Array<[number, number]> = [from];
		while (queue.length) {
			const [x, y] = queue.shift()!;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx, ny = y + dy;
				if (ny < 0 || nx < 0 || ny >= block.length || nx >= block[0].length || block[ny][nx]) continue;
				const key = `${nx},${ny}`;
				if (seen.has(key)) continue;
				seen.add(key);
				queue.push([nx, ny]);
			}
		}
		return seen;
	}

	/** The rectangles one frame draws inside a prop's footprint, after `warm` seconds of animation. */
	function propFrame(prop: Prop, features: Record<string, unknown>, warm: number): unknown[][] {
		const rects: unknown[][] = [];
		// A fixed random source keeps the idle orchestrator at its rest spot, so no figure walks through a footprint.
		const random = Math.random;
		Math.random = () => 0.5;
		let engine: { destroy(): void };
		try {
			engine = createOfficeEngine({ width: 0, height: 0, getContext: () => styledContext(rects) }, OFFICE_CONFIG);
			(engine as { setScene(v: unknown): void }).setScene(view([], features));
			run(warm);
			rects.length = 0;
			run(1 / 60);
		} finally {
			Math.random = random;
		}
		engine.destroy();
		const T = OFFICE_CONFIG.tile;
		const [x0, y0, x1, y1] = [prop.x * T, prop.y * T, (prop.x + prop.w) * T, (prop.y + prop.h) * T];
		return rects.filter(([x, y]) => (x as number) >= x0 && (x as number) < x1 && (y as number) >= y0 && (y as number) < y1);
	}

	it("keeps every prop inside the room, off the wall and on its own tiles", () => {
		const taken = new Set<string>();
		for (const prop of props()) {
			assert.ok(prop.x >= 0 && prop.y >= 2 && prop.x + prop.w <= OFFICE_CONFIG.cols && prop.y + prop.h <= OFFICE_CONFIG.rows, `${prop.feature} fits the room`);
			for (let j = prop.y; j < prop.y + prop.h; j++) for (let i = prop.x; i < prop.x + prop.w; i++) {
				assert.ok(!taken.has(`${i},${j}`), `${prop.feature} overlaps another prop at ${i},${j}`);
				taken.add(`${i},${j}`);
			}
		}
		assert.deepEqual([...new Set(props().map(p => p.feature))].sort(), [...FEATURES].sort(), "one prop per feature");
	});

	it("walk spots, desks, the bench and the door stay reachable with every prop placed", () => {
		const block = engineModule.walkableGrid(OFFICE_CONFIG, props());
		const rest: [number, number] = [OFFICE_CONFIG.orchStart.x, OFFICE_CONFIG.orchStart.y];
		const seen = reachableFrom(block, rest);
		const spots: Array<[number, number, string]> = [
			[9, 3, "whiteboard"], [17, 4, "coffee"], [8, 6, "front"], [9, 5, "rest"],
			[1, 5, "desk 1"], [5, 5, "desk 2"], [1, 9, "desk 3"], [5, 9, "desk 4"],
			[9, 12, "door"], [10, 12, "door"],
		];
		for (let i = 2; i < 2 + 12; i++) spots.push([i, 11, "bench overflow"]);
		for (const [x, y, name] of spots) assert.ok(seen.has(`${x},${y}`), `${name} at ${x},${y} is reachable`);
	});

	it("a scene with every feature active renders without errors", () => {
		const everyFeature = Object.fromEntries(FEATURES.map(feature => [feature, { running: true, until: 0 }]));
		const rects: number[][] = [];
		const engine = createOfficeEngine({ width: 0, height: 0, getContext: () => recordingContext(rects) }, OFFICE_CONFIG);
		assert.doesNotThrow(() => {
			engine.setScene(view([resident("t1", seat("desk", 0), "running", true)], everyFeature));
			run(5);
		});
		engine.destroy();
		assert.ok(rects.length > 0);
		assert.ok(rects.every(args => args.every(Number.isFinite)), "no drawn rectangle has a NaN coordinate");
	});

	it("each prop draws differently when its feature is active than when idle", () => {
		for (const prop of props()) {
			const idle = propFrame(prop, {}, 1);
			const on = propFrame(prop, active(prop.feature), 1);
			assert.notDeepEqual(on, idle, `${prop.feature} shows activity`);
		}
	});

	it("under reduced motion an active prop holds the same pixels from one moment to the next", () => {
		reduced = true;
		for (const prop of props()) {
			const early = propFrame(prop, active(prop.feature), 0.5);
			const later = propFrame(prop, active(prop.feature), 2.5);
			assert.ok(later.length > 0, `${prop.feature} draws its on state`);
			assert.deepEqual(later, early, `${prop.feature} does not move under reduced motion`);
		}
	});
});
