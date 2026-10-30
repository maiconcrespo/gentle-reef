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
const resident = (id: string, where: { zone: "desk" | "bench"; index: number }, status: string, instant = false, role = "worker", claimed = false) => ({
	id,
	agent: `gentle-ai-${role}`,
	role,
	label: id,
	status,
	seat: where,
	leaving: !["queued", "running", "waiting"].includes(status),
	instant,
	claimed,
});
/** Idle staff for the lounge (S16): every role present unless listed in `absent`. */
const staffView = (absent: string[] = []) => ["explore", "worker", "verify"].map(role => ({ role, present: !absent.includes(role), claimedBy: absent.includes(role) ? "busy" : null }));
const view = (agents: unknown[], features: Record<string, unknown> = {}, staff: unknown[] = []) => ({
	intent: "floor", writing: false, bubble: null, brewing: false, orchestrator: "idle",
	percent: null, potLevel: 1, activeAgents: 0, agents, features, staff,
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
			[9, 3, "whiteboard"], [17, 4, "coffee"], [17, 5, "coffee approach"], [8, 6, "front"], [9, 5, "rest"],
			[1, 5, "desk 1"], [5, 5, "desk 2"], [1, 9, "desk 3"], [5, 9, "desk 4"],
			[9, 12, "door"], [10, 12, "door"],
		];
		for (let i = 2; i < 2 + 12; i++) spots.push([i, 11, "bench overflow"]);
		// A lounge spot is blocked for walkers, but a walker can still end on it: one of its neighbours must be reachable (S16).
		for (const [name, tile] of Object.entries((OFFICE_CONFIG as unknown as { lounge: Record<string, { x: number; y: number }> }).lounge)) {
			const neighbours = [[tile.x + 1, tile.y], [tile.x - 1, tile.y], [tile.x, tile.y + 1], [tile.x, tile.y - 1]];
			assert.ok(neighbours.some(([x, y]) => seen.has(`${x},${y}`)), `${name} lounge spot ${tile.x},${tile.y} can be reached`);
		}
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

describe("story camera: an optional view transform", () => {
	// Records every setTransform call and fillRect on the on-screen canvas, so the camera's transform can be read back.
	const cameraContext = (transforms: number[][], rects: number[][]): Record<string, unknown> =>
		new Proxy({} as Record<string, unknown>, {
			get: (target, key) => {
				if (key === "setTransform") return (...args: number[]) => { transforms.push(args); };
				if (key === "fillRect") return (...args: number[]) => { rects.push(args); };
				return key in target ? target[key as string] : () => undefined;
			},
			set: (target, key, value) => { target[key as string] = value; return true; },
		});

	/** The browser's canvas: `width` and `height` are the backing store the engine sets. */
	function onScreen() {
		const transforms: number[][] = [];
		const rects: number[][] = [];
		const canvas = { width: 0, height: 0, getContext: () => cameraContext(transforms, rects) };
		return { canvas, transforms, rects };
	}

	it("the zoom is an integer that fits the window, at least 1", () => {
		assert.equal(typeof engineModule.storyZoom, "function", "storyZoom is exported");
		assert.equal(engineModule.storyZoom(1860, 900), 4);
		assert.equal(engineModule.storyZoom(520, 900), 3);
		assert.equal(engineModule.storyZoom(200, 150), 1);
	});

	it("without a camera nothing is transformed and the canvas keeps the room size", () => {
		const { canvas, transforms } = onScreen();
		const engine = createOfficeEngine(canvas, OFFICE_CONFIG, {});
		engine.setScene(view([resident("t1", seat("desk", 0), "running")]));
		run(2);
		assert.equal(transforms.length, 0);
		assert.equal(canvas.width, OFFICE_CONFIG.cols * OFFICE_CONFIG.tile);
		assert.equal(canvas.height, OFFICE_CONFIG.rows * OFFICE_CONFIG.tile);
		engine.destroy();
	});

	it("a camera sizes the canvas to the window and renders with its zoom without errors", () => {
		const { canvas, transforms } = onScreen();
		const engine = createOfficeEngine(canvas, OFFICE_CONFIG, {});
		engine.setScene(view([resident("t1", seat("desk", 0), "running")]));
		engine.setCamera({ zoom: 4, width: 400, height: 300, target: { kind: "orchestrator" } });
		assert.equal(canvas.width, 400);
		assert.equal(canvas.height, 300);
		assert.doesNotThrow(() => run(2));
		assert.ok(transforms.length > 0);
		assert.deepEqual(transforms.at(-1)?.slice(0, 2), [4, 0], "scale is the zoom, no skew");
		engine.destroy();
	});

	it("the camera eases to a feature prop and clamps the view inside the room", () => {
		const { canvas, transforms } = onScreen();
		const engine = createOfficeEngine(canvas, OFFICE_CONFIG, {});
		engine.setScene(view([]));
		// memory prop: x 18, y 3, 1x2 tiles, so its centre is (444, 96) in room pixels. The view is 200x120 at zoom 2: half 50x30.
		engine.setCamera({ zoom: 2, width: 200, height: 120, target: { kind: "feature", feature: "memory" } });
		run(5);
		// x clamps to 480 - 50 = 430 (room width) and y stays at 96. The translation puts that point at the view centre.
		assert.deepEqual(transforms.at(-1), [2, 0, 0, 2, -760, -132]);
		engine.destroy();
	});

	it("a point target is followed, and clearing the camera restores the room size and drawing", () => {
		const { canvas, transforms } = onScreen();
		const engine = createOfficeEngine(canvas, OFFICE_CONFIG, {});
		engine.setScene(view([]));
		engine.setCamera({ zoom: 1, width: 480, height: 312, target: { x: 240, y: 156 } });
		run(1);
		const before = transforms.length;
		engine.setCamera(null);
		assert.equal(canvas.width, 480);
		assert.equal(canvas.height, 312);
		run(1);
		assert.equal(transforms.length, before, "no transform once the camera is off");
		engine.destroy();
	});
});

describe("idle staff in the lounge (S16)", () => {
	const T = OFFICE_CONFIG.tile;
	const LOUNGE = (OFFICE_CONFIG as unknown as { lounge: Record<string, { x: number; y: number }> }).lounge;
	// Torso colours of the explore, worker and verify looks (P.blue, P.green, P.purple).
	const TORSO: Record<string, string> = { explore: "#A9C7EE", worker: "#B4E7C7", verify: "#F095C8" };
	const BLUE = TORSO.explore;
	type Rect = [number, number, number, number, string];
	const inTile = (x: number, y: number, tile: { x: number; y: number }) => x >= tile.x * T && x < (tile.x + 1) * T && y >= tile.y * T && y < (tile.y + 1) * T;
	// The lounge area around the coffee counter: the three staff, their bubbles and their sips.
	const inLounge = (x: number, y: number) => x >= 13 * T && x < 17 * T && y >= 4 * T && y < 7 * T;
	const isBubble = ([, , w, h]: Rect) => w === 18 && h === 14;

	function room(camera?: { zoom: number; width: number; height: number; target: unknown }) {
		const rects: Rect[] = [];
		const departed: string[] = [];
		const canvas = { width: 0, height: 0, getContext: () => styledContext(rects as unknown[][]) };
		const engine = createOfficeEngine(canvas, OFFICE_CONFIG, { onDeparted: (id: string) => departed.push(id) });
		if (camera) engine.setCamera(camera as never);
		return { engine, rects, departed };
	}

	it("full and dock layouts: each idle staff member stands in its lounge spot", () => {
		const { engine, rects } = room();
		engine.setScene(view([], {}, staffView()));
		run(1);
		engine.destroy();
		for (const role of ["explore", "worker", "verify"]) {
			assert.ok(rects.some(([x, y, , , fill]) => fill === TORSO[role] && inTile(x, y, LOUNGE[role])), `${role} stands in the lounge`);
		}
	});

	it("story layout: the lounge staff are drawn in the same spots under the camera", () => {
		const { engine, rects } = room({ zoom: 2, width: 960, height: 600, target: { kind: "orchestrator" } });
		engine.setScene(view([], {}, staffView()));
		run(1);
		engine.destroy();
		for (const role of ["explore", "worker", "verify"]) {
			assert.ok(rects.some(([x, y, , , fill]) => fill === TORSO[role] && inTile(x, y, LOUNGE[role])), `${role} stands in the lounge`);
		}
	});

	it("reduced motion: the lounge staff still stand in their spots", () => {
		reduced = true;
		const { engine, rects } = room();
		engine.setScene(view([], {}, staffView()));
		run(1);
		engine.destroy();
		for (const role of ["explore", "worker", "verify"]) {
			assert.ok(rects.some(([x, y, , , fill]) => fill === TORSO[role] && inTile(x, y, LOUNGE[role])), `${role} stands in the lounge`);
		}
	});

	it("a claimed staff member is not drawn in the lounge: its resident is at the desk", () => {
		const { engine, rects } = room();
		engine.setScene(view([resident("t1", seat("desk", 0), "running", true, "explore", true)], {}, staffView(["explore"])));
		run(1);
		engine.destroy();
		assert.ok(!rects.some(([x, y, w, h, fill]) => fill === BLUE && w === 12 && h === 11 && inTile(x, y, LOUNGE.explore)), "no explore torso in the lounge");
	});

	it("a claimed resident starts from its lounge spot, not from the door", () => {
		const { engine, rects } = room();
		engine.setScene(view([resident("t1", seat("desk", 0), "running", false, "explore", true)], {}, staffView(["explore"])));
		run(0.05);
		engine.destroy();
		const torsos = rects.filter(([, , w, h, fill]) => w === 12 && h === 11 && fill === BLUE);
		assert.ok(torsos.length > 0, "the resident is drawn");
		assert.ok(torsos.every(([x, y]) => inTile(x, y, LOUNGE.explore)), "it starts on its lounge spot");
	});

	/** Runs one agent from finishing until it is reported departed; returns where its torso was last drawn. */
	function lastTorsoBeforeDeparture(claimed: boolean) {
		const { engine, rects, departed } = room();
		engine.setScene(view([resident("t1", seat("desk", 0), "running", true, "explore", claimed)], {}, staffView(["explore"])));
		run(1);
		engine.setScene(view([resident("t1", seat("desk", 0), "completed", true, "explore", claimed)], {}, staffView(["explore"])));
		let last: [number, number] | null = null;
		for (let i = 0; i < 60 * 40 && departed.length === 0; i++) {
			rects.length = 0;
			run(1 / 60);
			const torso = rects.find(([, , w, h, fill]) => w === 12 && h === 11 && fill === BLUE);
			// The feet, not the torso's top edge: a figure bobs a pixel or two while it walks, and it stands on its tile by its feet.
			if (torso) last = [torso[0] + 6, torso[1] + 20];
		}
		engine.destroy();
		return { last, departed };
	}

	it("a finished claimant walks back to its lounge spot before it leaves", () => {
		const { last, departed } = lastTorsoBeforeDeparture(true);
		assert.deepEqual(departed, ["t1"]);
		assert.ok(last && inTile(last[0], last[1], LOUNGE.explore), `it leaves from the lounge, last seen at ${last}`);
	});

	it("a finished extra still walks out by the door", () => {
		const { last, departed } = lastTorsoBeforeDeparture(false);
		assert.deepEqual(departed, ["t1"]);
		assert.ok(last && !inTile(last[0], last[1], LOUNGE.explore), "it does not leave from the lounge");
		assert.ok(last && last[1] >= (OFFICE_CONFIG.rows - 2) * T, `it walks down to the door row, last seen at ${last}`);
	});

	it("the idle staff take turns on a speech bubble and sip now and then", () => {
		const { engine, rects } = room();
		engine.setScene(view([], {}, staffView()));
		const bubbleXs = new Set<number>();
		const poses: string[] = [];
		for (let i = 0; i < 60 * 12; i++) {
			rects.length = 0;
			run(1 / 60);
			const lounge = rects.filter(([x, y]) => inLounge(x, y));
			for (const rect of lounge) if (isBubble(rect)) bubbleXs.add(rect[0]);
			poses.push(JSON.stringify(lounge.filter(rect => !isBubble(rect))));
		}
		engine.destroy();
		assert.ok(bubbleXs.size >= 2, `at least two staff take a turn on a bubble (saw ${bubbleXs.size})`);
		assert.ok(new Set(poses).size > 1, "a sip changes a pose now and then");
	});

	it("under reduced motion the idle staff keep still and no bubble cycles", () => {
		reduced = true;
		const { engine, rects } = room();
		engine.setScene(view([], {}, staffView()));
		let bubbles = 0;
		const samples: string[] = [];
		for (let i = 0; i < 60 * 12; i++) {
			rects.length = 0;
			run(1 / 60);
			const lounge = rects.filter(([x, y]) => inLounge(x, y));
			bubbles += lounge.filter(isBubble).length;
			if (i === 60 || i === 60 * 7) samples.push(JSON.stringify(lounge));
		}
		engine.destroy();
		assert.notEqual(samples[0], "[]", "the staff are drawn in the lounge");
		assert.equal(bubbles, 0, "no bubble is drawn");
		assert.equal(samples[0], samples[1], "the poses hold still");
	});
});

describe("idle staff: a bench resident that takes its staff member", () => {
	it("starts again from its role's lounge spot, not from the bench it was queued on", () => {
		const LOUNGE_EXPLORE = (OFFICE_CONFIG as unknown as { lounge: Record<string, { x: number; y: number }> }).lounge.explore;
		const rects: Array<[number, number, number, number, string]> = [];
		const canvas = { width: 0, height: 0, getContext: () => styledContext(rects as unknown[][]) };
		const engine = createOfficeEngine(canvas, OFFICE_CONFIG, {});
		engine.setScene(view([resident("t1", seat("bench", 0), "queued", false, "explore", false)], {}, staffView()));
		run(1);
		// The desks have freed; the queued agent starts and is seated with its role's staff member free: it becomes the claimant.
		engine.setScene(view([resident("t1", seat("desk", 0), "running", false, "explore", true)], {}, staffView(["explore"])));
		rects.length = 0;
		run(1 / 60);
		engine.destroy();
		const torsos = rects.filter(([, , w, h, fill]) => w === 12 && h === 11 && fill === "#A9C7EE");
		assert.equal(torsos.length, 1, "one figure, the claimant");
		const [x, y] = torsos[0];
		assert.ok(x >= LOUNGE_EXPLORE.x * OFFICE_CONFIG.tile && x < (LOUNGE_EXPLORE.x + 1) * OFFICE_CONFIG.tile, `drawn at lounge x ${x}`);
		assert.ok(y >= LOUNGE_EXPLORE.y * OFFICE_CONFIG.tile && y < (LOUNGE_EXPLORE.y + 1) * OFFICE_CONFIG.tile + 4, `drawn at lounge y ${y}`);
	});
});

describe("idle staff: an extra of a busy role walks in from the door", () => {
	it("a new agent whose staff member is claimed starts at the door, not the lounge", () => {
		const T = OFFICE_CONFIG.tile;
		const rects: Array<[number, number, number, number, string]> = [];
		const canvas = { width: 0, height: 0, getContext: () => styledContext(rects as unknown[][]) };
		const engine = createOfficeEngine(canvas, OFFICE_CONFIG, {});
		engine.setScene(view([
			resident("t1", seat("desk", 0), "running", true, "explore", true),
			resident("t2", seat("desk", 1), "running", false, "explore", false),
		], {}, staffView(["explore"])));
		rects.length = 0;
		run(1 / 60);
		engine.destroy();
		const torsos = rects.filter(([, , w, h, fill]) => w === 12 && h === 11 && fill === "#A9C7EE");
		assert.equal(torsos.length, 2, "both explore residents are drawn");
		const atDoorRow = torsos.filter(([, y]) => y >= (OFFICE_CONFIG.rows - 2) * T);
		assert.equal(atDoorRow.length, 1, "exactly one of them is still at the door row, on its way in");
		const [x] = atDoorRow[0];
		assert.ok(x >= 8 * T && x < 11 * T, `it is at the door columns, x ${x}`);
	});
});
