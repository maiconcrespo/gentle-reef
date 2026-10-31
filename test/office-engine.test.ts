import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
// Browser module, loaded as-is. The canvas and frame loop are stubbed below; the engine is driven frame by frame.
import { HEAD_MAPS, OFFICE_CONFIG, SPRITE, createOfficeEngine, walkableGrid } from "../web/office-engine.js";
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

describe("partition walls (S18)", () => {
	it("are drawn one third of a tile thick, centred on their tile, and still block walkers", () => {
		const bg: number[][] = [];
		g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => recordingContext(bg) }) };
		createOfficeEngine({ width: 0, height: 0, getContext: () => recordingContext([]) }, OFFICE_CONFIG).destroy();
		const T = OFFICE_CONFIG.tile, third = T / 3, offset = (T - third) / 2;
		const grid = walkableGrid(OFFICE_CONFIG);
		for (const w of OFFICE_CONFIG.walls) for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) {
			const left = x * T + offset, top = y * T + offset;
			const covered = bg.some(([rx, ry, rw, rh]) => rx === left && rw === third && ry <= top && ry + rh >= top + third);
			assert.ok(covered, `wall tile ${x},${y} has a ${third} px square on its centre line`);
			assert.equal(grid[y][x], true, `wall tile ${x},${y} still blocks walkers`);
		}
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
		const cfg = OFFICE_CONFIG as unknown as { front: { x: number; y: number }; coffee: { x: number; y: number }; whiteboard: { x: number }; desks: Array<{ x: number; y: number; face: string }>; verifyDesks: Array<{ x: number; y: number; face: string }>; door: { x: number }; bench: { x: number; w: number }; rows: number; orchStart: { x: number; y: number } };
		const block = engineModule.walkableGrid(OFFICE_CONFIG, props());
		const seen = reachableFrom(block, [cfg.orchStart.x, cfg.orchStart.y]);
		const sit = (d: { x: number; y: number; face: string }): [number, number] => [d.x, d.face === "down" ? d.y - 1 : d.y + 1];
		const spots: Array<[number, number, string]> = [
			[cfg.whiteboard.x + 1, 3, "whiteboard"], [cfg.coffee.x + 1, cfg.coffee.y + 2, "coffee"], [cfg.front.x, cfg.front.y, "front"],
			...cfg.desks.map((d, i): [number, number, string] => [...sit(d), `desk ${i}`]),
			...cfg.verifyDesks.map((d, i): [number, number, string] => [...sit(d), `verify desk ${i}`]),
			[cfg.door.x, cfg.rows - 2, "door"], [cfg.door.x + 1, cfg.rows - 2, "door"],
		];
		for (let i = 0; i < 2 * cfg.bench.w; i++) spots.push([cfg.bench.x + (i % cfg.bench.w), cfg.rows - 2 - Math.floor(i / cfg.bench.w), "bench overflow"]);
		// A lounge seat is blocked for walkers, but a walker can still end on it: one of its neighbours must be reachable (S16).
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
		assert.equal(engineModule.storyZoom(1860, 900), 3);
		assert.equal(engineModule.storyZoom(520, 900), 3);
		assert.equal(engineModule.storyZoom(200, 150), 1);
	});

	it("the story zoom keeps at least 12 rows of the room in view (#10)", () => {
		const rowsInView = (width: number, height: number) => height / engineModule.storyZoom(width, height) / OFFICE_CONFIG.tile;
		assert.equal(engineModule.storyZoom(1366, 768), 2);
		assert.equal(engineModule.storyZoom(1920, 1080), 3);
		assert.equal(engineModule.storyZoom(2560, 1440), 4);
		for (const [width, height] of [[1366, 768], [1920, 1080], [2560, 1440]]) {
			assert.ok(rowsInView(width, height) >= 12, `${width}x${height} shows at least 12 rows`);
		}
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
		// memory prop: x 28, y 2, 1x2 tiles, so its centre is (684, 72) in room pixels. The view is 200x120 at zoom 2: half 50x30.
		engine.setCamera({ zoom: 2, width: 200, height: 120, target: { kind: "feature", feature: "memory" } });
		run(5);
		// x clamps to 720 - 50 = 670 (room width) and y stays at 72. The translation puts that point at the view centre.
		assert.deepEqual(transforms.at(-1), [2, 0, 0, 2, -1240, -84]);
		engine.destroy();
	});

	it("the camera follows the review inspectors to the midpoint of their check spots, and holds once none are on the floor", () => {
		const { canvas, transforms } = onScreen();
		const engine = createOfficeEngine(canvas, OFFICE_CONFIG, {});
		const review = (phase: string, extra: Record<string, unknown> = {}) => ({ ...view([], {}, []), review: { phase, count: 2, verdict: null, labels: ["Risk", "Reliability"], ...extra } });
		engine.setScene(review("arriving"));
		run(8);
		// The check spots are (9,12) and (13,12): their feet are at x 228 and 324, y 308. The midpoint is x 276, lifted 20 px to the figures' middle.
		engine.setCamera({ zoom: 2, width: 200, height: 120, target: { kind: "inspector" } });
		run(5);
		assert.deepEqual(transforms.at(-1), [2, 0, 0, 2, -452, -516]);
		engine.setScene(review("leaving", { verdict: "correction" }));
		run(40);
		const held = transforms.at(-1);
		run(3);
		assert.deepEqual(transforms.at(-1), held, "once they are out the camera holds where it was");
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
		assert.equal(canvas.width, OFFICE_CONFIG.cols * OFFICE_CONFIG.tile);
		assert.equal(canvas.height, OFFICE_CONFIG.rows * OFFICE_CONFIG.tile);
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
	// The area over each lounge seat: its tile and the bubble above it, not the pod desks beside the sofas.
	const inLounge = (x: number, y: number) => Object.values(LOUNGE).some(t => x >= t.x * T && x < (t.x + 2) * T && y >= (t.y - 2) * T && y < (t.y + 1) * T);
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
		const door = (OFFICE_CONFIG as unknown as { door: { x: number; w: number } }).door;
		assert.ok(x >= (door.x - 1) * T && x < (door.x + door.w + 1) * T, `it is at the door columns, x ${x}`);
	});
});

describe("review inspectors: where they stand (T1, S1-S3)", () => {
	// Each inspector has a check spot by the door and a tour of two desks. The tour stops stand beside a desk, never on a resident's seat.
	const routes = () => {
		const found = (engineModule as unknown as { INSPECTOR?: { check: Array<{ tx: number; ty: number }>; tours: Array<Array<{ tx: number; ty: number; desk: number }>> } }).INSPECTOR;
		assert.ok(found, "INSPECTOR routes are exported");
		return found;
	};
	const cfg = OFFICE_CONFIG as unknown as { rows: number; cols: number; door: { x: number }; desks: Array<{ x: number; y: number; face: string }>; verifyDesks: Array<{ x: number; y: number; face: string }> };
	const blocked = walkableGrid(OFFICE_CONFIG as never);
	/* A desk's seat is the tile in front of it: north of a face-down desk, south of a face-up one. */
	const seatTiles = () => [...cfg.desks, ...cfg.verifyDesks].map(d => ({ tx: d.x, ty: d.face === "down" ? d.y - 1 : d.y + 1 }));

	it("every stop stands on walkable floor, and no stop is a resident's seat", () => {
		const r = routes();
		const stops = [...r.check, ...r.tours.flat()];
		for (const s of stops) {
			assert.equal(blocked[s.ty][s.tx], false, `(${s.tx},${s.ty}) is floor`);
			assert.ok(!seatTiles().some(t => t.tx === s.tx && t.ty === s.ty), `(${s.tx},${s.ty}) is not a seat`);
		}
		assert.equal(new Set(stops.map(s => `${s.tx},${s.ty}`)).size, stops.length, "no two inspectors share a stop");
	});

	it("every stop is reachable from the door", () => {
		const seen = new Set([`${cfg.door.x},${cfg.rows - 1}`]);
		const queue = [[cfg.door.x, cfg.rows - 1]];
		while (queue.length) {
			const [x, y] = queue.shift()!;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
				if (nx < 0 || ny < 0 || nx >= cfg.cols || ny >= cfg.rows || blocked[ny][nx] || seen.has(key)) continue;
				seen.add(key);
				queue.push([nx, ny]);
			}
		}
		const r = routes();
		for (const s of [...r.check, ...r.tours.flat()]) assert.ok(seen.has(`${s.tx},${s.ty}`), `(${s.tx},${s.ty}) is reachable`);
	});

	it("the two tours together check each of the four pod desks once", () => {
		const r = routes();
		assert.equal(r.tours.length, 2);
		for (const tour of r.tours) assert.equal(tour.length, 2, "two desks per inspector");
		assert.deepEqual(r.tours.flat().map(s => s.desk).sort(), [0, 1, 2, 3]);
	});
});

describe("review inspectors: walking, inspecting and leaving (T1, S1-S4)", () => {
	const T = OFFICE_CONFIG.tile;
	const lookOf = (engineModule as unknown as { INSPECTOR_LOOKS?: Array<{ suit: string }> }).INSPECTOR_LOOKS;
	const INSPECTOR = (engineModule as unknown as { INSPECTOR: { check: Array<{ tx: number; ty: number }>; tours: Array<Array<{ tx: number; ty: number }>> } }).INSPECTOR;
	const BLANK = { phase: "idle", count: 0, verdict: null, labels: ["Risk", "Reliability"] };
	const scene = (review: Record<string, unknown>) => ({ ...view([], {}, staffView()), review: { ...BLANK, ...review } });
	const arriving = () => scene({ phase: "arriving" });
	const inspecting = (count = 2) => scene({ phase: "inspecting", count });
	const verdict = (value: string) => scene({ phase: "verdict", verdict: value });
	const leaving = (value: string | null = null) => scene({ phase: "leaving", verdict: value });
	type Rect = [number, number, number, number, string];

	/** The inspector's torso is its one 12x11 block in its suit colour. Its tile is where the figure stands. */
	const torsoAt = (rects: Rect[], suit: string) => rects
		.filter(([, , w, h, fill]) => w === 12 && h === 11 && fill === suit)
		.map(([x, y]) => ({ tx: Math.floor((x + 6) / T), ty: Math.floor((y + 20) / T) }));
	const bubbles = (rects: Rect[]) => rects.filter(([, , w, h]) => w === 18 && h === 14);
	const GREEN = "#B4E7C7";

	function room(reduce = false) {
		reduced = reduce;
		const rects: Rect[] = [];
		let gone = 0;
		const canvas = { width: 0, height: 0, getContext: () => styledContext(rects as unknown[][]) };
		const engine = createOfficeEngine(canvas, OFFICE_CONFIG, { onReviewGone: () => { gone += 1; } });
		const frame = () => { rects.length = 0; run(1 / 60); return rects; };
		return { engine, frame, gone: () => gone };
	}

	it("each inspector wears its own suit colour, distinct from the residents' colours", () => {
		assert.ok(lookOf, "INSPECTOR_LOOKS is exported");
		const [a, b] = lookOf.map(l => l.suit);
		assert.notEqual(a, b);
		for (const resident of ["#A9C7EE", "#B4E7C7", "#C4DAF6", "#F095C8"]) assert.ok(a !== resident && b !== resident);
	});

	it("arriving: both inspectors walk in from the door and stop at their check spots", () => {
		const { engine, frame } = room();
		const suits = (engineModule as unknown as { INSPECTOR_LOOKS: Array<{ suit: string }> }).INSPECTOR_LOOKS.map(l => l.suit);
		engine.setScene(arriving());
		const first = frame();
		for (const suit of suits) {
			const at = torsoAt(first, suit);
			assert.equal(at.length, 1, "one torso per inspector on its first frame");
			assert.ok(at[0].ty >= OFFICE_CONFIG.rows - 2, "it starts at the door row");
		}
		run(8);
		const settled = frame();
		INSPECTOR.check.forEach((spot, i) => assert.deepEqual(torsoAt(settled, suits[i]), [{ tx: spot.tx, ty: spot.ty }]));
		engine.destroy();
	});

	it("inspecting: each inspector walks to both of its desk stops in turn", () => {
		const { engine, frame } = room();
		const suits = (engineModule as unknown as { INSPECTOR_LOOKS: Array<{ suit: string }> }).INSPECTOR_LOOKS.map(l => l.suit);
		engine.setScene(arriving());
		run(8);
		engine.setScene(inspecting(2));
		const visited = suits.map(() => new Set<string>());
		for (let i = 0; i < 20 * 4; i++) {
			run(0.25);
			const rects = frame();
			suits.forEach((suit, k) => torsoAt(rects, suit).forEach(t => visited[k].add(`${t.tx},${t.ty}`)));
		}
		INSPECTOR.tours.forEach((tour, k) => tour.forEach(stop => assert.ok(visited[k].has(`${stop.tx},${stop.ty}`), `inspector ${k} stands at its desk stop ${stop.tx},${stop.ty}`)));
		engine.destroy();
	});

	it("an approved verdict walks them back to their check spots with the check bubble over them", () => {
		const { engine, frame } = room();
		const suits = (engineModule as unknown as { INSPECTOR_LOOKS: Array<{ suit: string }> }).INSPECTOR_LOOKS.map(l => l.suit);
		engine.setScene(arriving());
		run(8);
		engine.setScene(inspecting(2));
		run(3);
		engine.setScene(verdict("approved"));
		run(20);
		const rects = frame();
		INSPECTOR.check.forEach((spot, i) => {
			assert.deepEqual(torsoAt(rects, suits[i]), [{ tx: spot.tx, ty: spot.ty }]);
			const box = bubbles(rects).find(([x]) => Math.abs(x - (spot.tx * T + 12 - 9)) <= 2);
			assert.ok(box, `a bubble hangs over inspector ${i}`);
			assert.ok(rects.some(([x, y, w, h, fill]) => fill === GREEN && w === 2 && x >= box[0] && y >= box[1] && y < box[1] + 14), "the bubble holds the check");
		});
		engine.destroy();
	});

	it("a correction verdict sends them out through the door with the bang, and reports the review gone once they are out", () => {
		const { engine, frame, gone } = room();
		engine.setScene(arriving());
		run(8);
		engine.setScene(inspecting(2));
		run(3);
		engine.setScene(leaving("correction"));
		run(0.5);
		assert.ok(bubbles(frame()).length >= 1, "the bang shows before they walk");
		assert.equal(gone(), 0);
		run(30);
		assert.equal(gone(), 1, "reported once, after both left");
		assert.equal(torsoAt(frame(), (engineModule as unknown as { INSPECTOR_LOOKS: Array<{ suit: string }> }).INSPECTOR_LOOKS[0].suit).length, 0, "gone from the room");
		run(5);
		assert.equal(gone(), 1, "reported once");
		engine.destroy();
	});

	it("a sign-off after an approval: they hold the check for a beat, then walk out and the review is reported gone", () => {
		const { engine, gone } = room();
		engine.setScene(arriving());
		run(8);
		engine.setScene(inspecting(2));
		run(3);
		engine.setScene(verdict("approved"));
		run(10);
		engine.setScene(leaving("approved"));
		run(0.5);
		assert.equal(gone(), 0, "still on the floor during the beat");
		run(30);
		assert.equal(gone(), 1);
		engine.destroy();
	});

	it("a leave with no inspector on the floor reports the review gone at once, once", () => {
		const { engine, frame, gone } = room();
		engine.setScene(leaving());
		frame();
		assert.equal(gone(), 1);
		run(2);
		assert.equal(gone(), 1);
		engine.destroy();
	});

	it("a new review while they are walking out walks them back in, and no departure is reported", () => {
		const { engine, frame, gone } = room();
		engine.setScene(arriving());
		run(8);
		engine.setScene(inspecting(2));
		run(3);
		engine.setScene(leaving("correction"));
		run(0.5);
		engine.setScene(arriving());
		run(20);
		const rects = frame();
		const suits = (engineModule as unknown as { INSPECTOR_LOOKS: Array<{ suit: string }> }).INSPECTOR_LOOKS.map(l => l.suit);
		INSPECTOR.check.forEach((spot, i) => assert.deepEqual(torsoAt(rects, suits[i]), [{ tx: spot.tx, ty: spot.ty }]));
		run(10);
		assert.equal(gone(), 0);
		engine.destroy();
	});

	it("under reduced motion they snap to their spots, and leave after the same beat without walking", () => {
		const { engine, frame, gone } = room(true);
		const suits = (engineModule as unknown as { INSPECTOR_LOOKS: Array<{ suit: string }> }).INSPECTOR_LOOKS.map(l => l.suit);
		engine.setScene(arriving());
		const first = frame();
		INSPECTOR.check.forEach((spot, i) => assert.deepEqual(torsoAt(first, suits[i]), [{ tx: spot.tx, ty: spot.ty }], "placed at once"));
		engine.setScene(leaving("correction"));
		run(1);
		assert.equal(gone(), 0, "the bang shows first");
		run(1.5);
		assert.equal(gone(), 1);
		engine.destroy();
	});
});

describe("office floor plan (S17): rooms, lounge crew and short walks", () => {
	type Cfg = { cols: number; rows: number; tile: number; desks: Array<{ x: number; y: number; face: string }>; verifyDesks: Array<{ x: number; y: number; face: string }>; lounge: Record<string, { x: number; y: number; face: string }>; rooms: Array<{ name: string; x: number; y: number; w: number; h: number }>; plants: Array<{ x: number; y: number }>; front: { x: number; y: number }; whiteboard: { x: number; w: number }; coffee: { x: number; y: number; w: number }; door: { x: number; w: number }; bench: { x: number; w: number } };
	const CFG = OFFICE_CONFIG as unknown as Cfg;
	const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

	/** Walking steps from `from` to `to` on the engine's grid (the start may be blocked, the way a lounge seat is). Undefined when unreachable. */
	function stepsFrom(block: boolean[][], from: [number, number], to: [number, number]): number | undefined {
		const dist = new Map<string, number>([[from.join(","), 0]]);
		const queue: Array<[number, number]> = [from];
		while (queue.length) {
			const [x, y] = queue.shift()!;
			if (x === to[0] && y === to[1]) return dist.get(`${x},${y}`);
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx, ny = y + dy;
				if (ny < 0 || nx < 0 || ny >= block.length || nx >= block[0].length) continue;
				if (block[ny][nx] && !(nx === to[0] && ny === to[1])) continue;
				const key = `${nx},${ny}`;
				if (dist.has(key)) continue;
				dist.set(key, dist.get(`${x},${y}`)! + 1);
				queue.push([nx, ny]);
			}
		}
		return undefined;
	}
	/** The tile a seated figure at a desk sits on: the side opposite its monitor (down-facing desks have their sitter to the north). */
	const sitterTile = (d: { x: number; y: number; face: string }): [number, number] => [d.x, d.face === "down" ? d.y - 1 : d.y + 1];
	const block = () => engineModule.walkableGrid(OFFICE_CONFIG, props());
	/** Every tile reachable from `from` on the engine's grid (true = blocked). */
	function reachableFrom(grid: boolean[][], from: [number, number]): Set<string> {
		const seen = new Set<string>([from.join(",")]);
		const queue: Array<[number, number]> = [from];
		while (queue.length) {
			const [x, y] = queue.shift()!;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx, ny = y + dy;
				if (ny < 0 || nx < 0 || ny >= grid.length || nx >= grid[0].length || grid[ny][nx]) continue;
				const key = `${nx},${ny}`;
				if (seen.has(key)) continue;
				seen.add(key);
				queue.push([nx, ny]);
			}
		}
		return seen;
	}
	const props = (): Array<{ feature: string; x: number; y: number; w: number; h: number }> => (engineModule as unknown as { FEATURE_PROPS: Array<{ feature: string; x: number; y: number; w: number; h: number }> }).FEATURE_PROPS;

	it("the lounge crew is not in one straight line", () => {
		const [a, b, c] = ["explore", "worker", "verify"].map(role => CFG.lounge[role]);
		const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
		assert.notEqual(cross, 0, `lounge spots ${[a, b, c].map(s => `${s.x},${s.y}`).join(" ")} must not be collinear`);
	});

	it("each lounge seat is at most two steps from the desk its role takes first", () => {
		const grid = block();
		const pairs: Array<[string, { x: number; y: number }, [number, number]]> = [
			["explore", CFG.lounge.explore, sitterTile(CFG.desks[0])],
			["worker", CFG.lounge.worker, sitterTile(CFG.desks[1])],
			["verify", CFG.lounge.verify, sitterTile(CFG.verifyDesks[0])],
		];
		for (const [role, seat, desk] of pairs) {
			const steps = stepsFrom(grid, [seat.x, seat.y], desk);
			assert.ok(steps !== undefined && steps <= 2, `${role} walks ${steps} steps from ${seat.x},${seat.y} to its desk at ${desk}; two is about 1.1 s`);
		}
	});

	it("the room has a verify corner with two seats, and every resident desk has its sitter tile free", () => {
		assert.equal(CFG.verifyDesks.length, 2, "two verify seats");
		const grid = block();
		for (const d of [...CFG.desks, ...CFG.verifyDesks]) {
			const [x, y] = sitterTile(d);
			assert.equal(grid[y][x], false, `sitter tile ${x},${y} is free`);
		}
	});

	it("every room is split off by walls and has a reachable floor tile inside it", () => {
		assert.ok(Array.isArray(CFG.rooms) && CFG.rooms.length >= 4, "rooms are listed");
		const grid = block();
		const seen = reachableFrom(grid, [CFG.front.x, CFG.front.y]);
		for (const room of CFG.rooms) {
			const reached = [...seen].some(key => { const [x, y] = key.split(",").map(Number); return inRect(x, y, room); });
			assert.ok(reached, `${room.name} can be walked into`);
		}
	});

	it("every room has at least one plant", () => {
		assert.ok(Array.isArray(CFG.plants) && CFG.plants.length >= CFG.rooms.length, "a plant per room at least");
		for (const room of CFG.rooms) assert.ok(CFG.plants.some(p => inRect(p.x, p.y, room)), `${room.name} has a plant`);
	});

	it("the new spots are reachable: whiteboard, coffee, front, verify seats, bell approach and the bench", () => {
		const grid = block();
		const seen = reachableFrom(grid, [CFG.front.x, CFG.front.y]);
		const spots: Array<[number, number, string]> = [
			[CFG.whiteboard.x + 1, 3, "whiteboard"], [CFG.coffee.x + 1, CFG.coffee.y + 2, "coffee"],
			[CFG.front.x, CFG.front.y, "front"], ...CFG.verifyDesks.map((d, i): [number, number, string] => [...sitterTile(d), `verify seat ${i}`]),
			...CFG.desks.map((d, i): [number, number, string] => [...sitterTile(d), `desk ${i}`]),
			[CFG.door.x, CFG.rows - 2, "door approach"], [CFG.bench.x, CFG.rows - 2, "bench"],
		];
		for (const [x, y, name] of spots) assert.ok(seen.has(`${x},${y}`), `${name} at ${x},${y} is reachable`);
	});

	it("the orchestrator rests in its office and does not wander across the room while idle", () => {
		const rects: unknown[][] = [];
		const random = Math.random;
		Math.random = () => 0.9;
		let engine: { destroy(): void; setScene(v: unknown): void };
		try {
			engine = createOfficeEngine({ width: 0, height: 0, getContext: () => styledContext(rects as unknown[][]) }, OFFICE_CONFIG) as never;
			engine.setScene(view([], {}, staffView()));
			for (let i = 0; i < 60 * 40; i++) run(1 / 60);
		} finally {
			Math.random = random;
			engine!.destroy();
		}
		const office = (CFG.rooms as Array<{ name: string; x: number; y: number; w: number; h: number }>).find(r => r.name === "orchestrator office")!;
		const T = CFG.tile;
		const torsos = rects.filter(([, , w, h, fill]) => w === 12 && h === 11 && fill === "#E0C27A") as Array<[number, number]>;
		assert.ok(torsos.length > 0, "the orchestrator is drawn");
		assert.ok(torsos.every(([x, y]) => x >= office.x * T && x < (office.x + office.w) * T && y >= office.y * T && y < (office.y + office.h) * T), "every frame keeps it inside its office");
	});

	it("the front spot is in the upper half of the room, above the ask dialog", () => {
		assert.ok(CFG.front.y < CFG.rows / 2, `front row ${CFG.front.y} is in the upper half`);
	});

	it("the floor is light and low-contrast: planks differ by a few levels only", () => {
		const tones = (engineModule as unknown as { FLOOR_TONES: { a: string; b: string; seam: string } }).FLOOR_TONES;
		assert.ok(tones, "FLOOR_TONES is exported");
		const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
		const [a, b] = [channels(tones.a), channels(tones.b)];
		for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) <= 10, `plank channel ${i} differs by at most 10`);
		assert.ok(a.reduce((s, v) => s + v, 0) / 3 >= 110, "the planks are light enough to read as a floor");
	});

	it("the room's height fits 2x in a 900 px window, beside the header and footer", () => {
		// The width is not asserted: the full layout's stage column is narrower than 2x the room, so it shows 1x or the pan (see docs/reference.md).
		assert.ok(CFG.rows * CFG.tile * 2 <= 780, "height at 2x leaves room for the header and footer");
	});
});
