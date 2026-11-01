import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { encodePng } from "../src/stage/png.ts";
import { createRaster } from "../src/stage/raster.ts";
import { COFFEE_AFTER_MS, GAVEL_STRIKE_MS, coffeeClock, gavelClock, frameFromSnapshot, renderHqPng, renderPortraitPng } from "../src/stage/frame.ts";
import { HQ_HEIGHT, HQ_PALETTE, HQ_WIDTH, drawHq, drawHqPortrait } from "../web/hq-scene.js";

/** Splits a PNG into its chunks, checking each CRC. */
function chunks(png: Buffer): Array<{ type: string; data: Buffer }> {
	assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "PNG signature");
	const out: Array<{ type: string; data: Buffer }> = [];
	for (let at = 8; at < png.length; ) {
		const length = png.readUInt32BE(at);
		const type = png.toString("latin1", at + 4, at + 8);
		const data = png.subarray(at + 8, at + 8 + length);
		assert.equal(png.readUInt32BE(at + 8 + length), crc32(png.subarray(at + 4, at + 8 + length)), `${type} CRC`);
		out.push({ type, data });
		at += 12 + length;
	}
	return out;
}
function crc32(bytes: Buffer): number {
	let c = ~0;
	for (const b of bytes) {
		c ^= b;
		for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
	}
	return ~c >>> 0;
}
const hex = (raster: { width: number; data: Uint8Array }, x: number, y: number): string => {
	const i = (y * raster.width + x) * 4;
	return "#" + [0, 1, 2].map(k => raster.data[i + k]!.toString(16).padStart(2, "0")).join("").toUpperCase();
};

describe("PNG encoder (no native dependency)", () => {
	it("writes IHDR with the size, then the RGBA rows behind filter byte 0, then IEND", () => {
		const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 1, 2, 3, 4]);
		const parts = chunks(encodePng(rgba, 2, 2));
		assert.deepEqual(parts.map(p => p.type), ["IHDR", "IDAT", "IEND"]);
		const ihdr = parts[0]!.data;
		assert.equal(ihdr.readUInt32BE(0), 2);
		assert.equal(ihdr.readUInt32BE(4), 2);
		assert.deepEqual([...ihdr.subarray(8)], [8, 6, 0, 0, 0], "8-bit RGBA, no interlace");
		assert.deepEqual([...inflateSync(parts[1]!.data)], [0, 255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 255, 255, 1, 2, 3, 4]);
	});

	it("rejects a buffer that does not match the size", () => {
		assert.throws(() => encodePng(new Uint8Array(7), 1, 2), /RGBA/);
	});
});

describe("raster (the canvas stand-in)", () => {
	it("fillRect paints #rrggbb opaque, clipped to the raster", () => {
		const r = createRaster(4, 3);
		r.fillStyle = "#F095C8";
		r.fillRect(-2, 1, 4, 5);
		assert.equal(hex(r, 0, 1), "#F095C8");
		assert.equal(hex(r, 1, 2), "#F095C8");
		assert.equal(hex(r, 2, 1), "#000000", "outside the rect is untouched");
		assert.equal(r.data[(1 * 4 + 0) * 4 + 3], 255);
	});

	it("globalAlpha blends over what is there", () => {
		const r = createRaster(1, 1);
		r.fillStyle = "#FFFFFF"; r.fillRect(0, 0, 1, 1);
		r.globalAlpha = 0.5; r.fillStyle = "#000000"; r.fillRect(0, 0, 1, 1);
		assert.equal(hex(r, 0, 0), "#808080");
	});
});

describe("Gentle HQ room (web/hq-scene.js)", () => {
	it("paints the 720 x 408 room: the orchestrator's pink suit and the black chalkboard", () => {
		const r = createRaster(HQ_WIDTH, HQ_HEIGHT);
		drawHq(r, { t: 0, motion: false });
		assert.equal(hex(r, 359, 97), HQ_PALETTE.pink.toUpperCase(), "suit");
		assert.equal(hex(r, 360, 30), HQ_PALETTE.bg.toUpperCase(), "chalkboard");
	});

	it("is deterministic for the same frame", () => {
		const a = createRaster(HQ_WIDTH, HQ_HEIGHT), b = createRaster(HQ_WIDTH, HQ_HEIGHT);
		drawHq(a, { t: 3, motion: true, thinking: true });
		drawHq(b, { t: 3, motion: true, thinking: true });
		assert.deepEqual(a.data, b.data);
	});
});

describe("Gentle HQ room shows the session state (T2)", () => {
	const paint = (frame: Record<string, unknown>) => { const r = createRaster(HQ_WIDTH, HQ_HEIGHT); drawHq(r, frame); return r; };
	const P = (name: keyof typeof HQ_PALETTE) => HQ_PALETTE[name].toUpperCase();

	it("the coffee pot (by the window, T4f) drains as context fills: full at 0%, empty at 100%, full when unknown", () => {
		assert.equal(hex(paint({ context: 0 }), 198, 58), P("sand"));
		assert.equal(hex(paint({ context: 100 }), 198, 58), P("panel"));
		assert.equal(hex(paint({ context: 50 }), 198, 62), P("sand"), "half: the bottom is still coffee");
		assert.equal(hex(paint({ context: 50 }), 198, 54), P("panel"), "half: the top is empty");
		assert.equal(hex(paint({}), 198, 58), P("sand"));
	});

	it("the monitor wall lights one screen per job (T4b): running sand bar, ok green, fail red, the rest switched off", () => {
		const r = paint({ jobs: ["running", "ok", "fail"] });
		assert.equal(hex(r, 524, 17), P("sand"), "screen 1: running");
		assert.equal(hex(r, 556, 17), P("green"), "screen 2: ok");
		assert.equal(hex(r, 588, 17), P("red"), "screen 3: fail");
		assert.equal(hex(r, 620, 17), P("bg"), "screen 4: off");
		assert.equal(hex(r, 524, 39), P("bg"), "second row: off");
		assert.equal(hex(paint({}), 524, 17), P("bg"), "no jobs: every screen off");
	});

	it("the dialog portrait (T4b) is the orchestrator's 24 x 24 face as a PNG at 4x, painted", () => {
		const png = Buffer.from(renderPortraitPng(), "base64");
		const ihdr = chunks(png)[0]!;
		assert.equal(ihdr.type, "IHDR");
		assert.deepEqual([ihdr.data.readUInt32BE(0), ihdr.data.readUInt32BE(4)], [96, 96]);
		const r = createRaster(24, 24);
		drawHqPortrait(r);
		assert.ok(r.data.some((v, i) => i % 4 === 3 && v > 0), "the portrait paints something");
	});

	it("the old coffee bar at the bottom left is gone: floor where the counter stood (the dialog covered it)", () => {
		const floor = [HQ_PALETTE.floorA, HQ_PALETTE.floorB, HQ_PALETTE.seam].map(c => c.toUpperCase());
		assert.ok(floor.includes(hex(paint({}), 60, 357)), hex(paint({}), 60, 357));
	});

	it("the chalkboard marks ODD steps lower on the board, under the project sign: done green, current gold, later muted", () => {
		const r = paint({ odd: 2 });
		assert.equal(hex(r, 277, 23), P("green"), "step 1");
		assert.equal(hex(r, 277, 39), P("gold"), "step 3");
		assert.equal(hex(r, 365, 23), P("muted"), "step 5");
		assert.equal(hex(paint({}), 277, 23), P("text"));
	});

	it("the TODO board has one row per task: done green, current pink, pending outlined; none when empty", () => {
		const r = paint({ todo: [{ done: true }, { now: true }, {}] });
		assert.equal(hex(r, 109, 154), P("green"));
		assert.equal(hex(r, 109, 165), P("fuchsia"));
		assert.equal(hex(r, 108, 175), P("border"));
		assert.notEqual(hex(paint({ todo: [] }), 109, 154), P("green"));
	});
});

describe("stage frame", () => {
	it("renders the room as a base64 PNG at 2x, so the terminal never has to upscale it", () => {
		const png = Buffer.from(renderHqPng({ t: 0, motion: false }), "base64");
		const ihdr = chunks(png)[0]!.data;
		assert.equal(ihdr.readUInt32BE(0), HQ_WIDTH * 2);
		assert.equal(ihdr.readUInt32BE(4), HQ_HEIGHT * 2);
	});
});

describe("snapshot to frame (event-to-scene mapping)", () => {
	const base = { v: 1, orchestrator: { state: "idle" }, context: { percent: null }, compaction: null, agents: [], ask: null, review: { phase: "idle", lenses: [], count: 0 } } as const;
	const agent = (role: string, status: string) => ({ v: 1, type: "subagent", id: role + status, agent: "gentle-ai-" + role, role, label: role, status });

	it("an idle session is a still room with a full pot", () => {
		assert.deepEqual(frameFromSnapshot(base as never), { motion: false, thinking: false, waiting: false, working: false, workers: 0, judging: false, exploring: false, context: null, brewing: false, reviewDesks: ["off", "off", "off", "off"] });
	});

	it("reads who acts, the context and compaction from the snapshot", () => {
		const frame = frameFromSnapshot({
			...base,
			orchestrator: { state: "waiting-user" },
			context: { percent: 38 },
			compaction: "start",
			agents: [agent("worker", "running"), agent("explore", "completed")],
		} as never);
		assert.equal(frame.waiting, true);
		assert.equal(frame.thinking, false);
		assert.equal(frame.working, true);
		assert.equal(frame.workers, 1, "one running worker");
		assert.equal(frame.exploring, false, "a finished explorer no longer acts");
		assert.equal(frame.context, 38);
		assert.equal(frame.brewing, true);
	});

	it("a tool call counts as thinking (the orchestrator is at the board)", () => {
		assert.equal(frameFromSnapshot({ ...base, orchestrator: { state: "tool", toolName: "read" } } as never).thinking, true);
	});
});

describe("workers' screens and the coffee break (terminal scene life T3, S3)", () => {
	const paint = (frame: Record<string, unknown>) => { const r = createRaster(HQ_WIDTH, HQ_HEIGHT); drawHq(r, frame); return r; };
	const P = (name: keyof typeof HQ_PALETTE) => HQ_PALETTE[name].toUpperCase();
	const DESKS = [244, 324, 404];
	const screen = (r: { width: number; data: Uint8Array }, x: number) => {
		const out: string[] = [];
		for (let y = 208; y < 222; y++) for (let sx = x + 6; sx < x + 28; sx++) out.push(hex(r, sx, y));
		return out.join(",");
	};

	it("a desk's screen moves only while its worker works; the others hold still", () => {
		const a = paint({ motion: true, t: 0, working: true, workers: 1 });
		const b = paint({ motion: true, t: 1, working: true, workers: 1 });
		assert.notEqual(screen(a, DESKS[0]), screen(b, DESKS[0]), "desk 1 works");
		assert.equal(screen(a, DESKS[1]), screen(b, DESKS[1]), "desk 2 is still");
		assert.equal(screen(a, DESKS[2]), screen(b, DESKS[2]), "desk 3 is still");
	});

	it("an idle desk shows a still game picture: a fuchsia hero on green ground, a gold coin", () => {
		for (const x of DESKS) {
			const r = paint({ workers: 0 });
			assert.equal(hex(r, x + 11, 216), P("fuchsia"), `desk ${x}: hero`);
			assert.equal(hex(r, x + 8, 220), P("green"), `desk ${x}: ground`);
			assert.equal(hex(r, x + 19, 212), P("gold"), `desk ${x}: coin`);
		}
		assert.notEqual(hex(paint({ workers: 3 }), DESKS[0] + 11, 216), P("fuchsia"), "a working desk shows code, not the game");
	});

	it("on a coffee break the workers leave their desks and stand at the coffee corner with a cup", () => {
		const desk = paint({}), coffee = paint({ coffee: true });
		const skin = HQ_PALETTE.sand.toUpperCase();
		for (const x of DESKS) {
			assert.equal(hex(desk, x + 44, 205), skin, `desk ${x}: worker seated`);
			assert.notEqual(hex(coffee, x + 44, 205), skin, `desk ${x}: chair empty`);
		}
		for (const cx of [182, 200]) {
			assert.equal(hex(coffee, cx - 2, 78), skin, `worker at ${cx}: face`);
			assert.equal(hex(coffee, cx + 7, 91), P("text"), `worker at ${cx}: cup`);
			assert.notEqual(hex(desk, cx - 2, 78), skin, `no worker at ${cx} while they work`);
		}
	});

	it("the coffee clock: a break after three minutes without a running worker, back to work when one starts", () => {
		assert.equal(COFFEE_AFTER_MS, 180_000);
		const clock = coffeeClock(1_000);
		assert.equal(clock.at(false, 1_000 + COFFEE_AFTER_MS - 1), false);
		assert.equal(clock.at(false, 1_000 + COFFEE_AFTER_MS), true);
		assert.equal(clock.at(true, 500_000), false, "a worker starts: everyone back at the desks");
		assert.equal(clock.at(false, 500_001), false);
		assert.equal(clock.dueAt(), 500_000 + COFFEE_AFTER_MS, "the next break is due three minutes after the last work");
		assert.equal(clock.at(false, 500_000 + COFFEE_AFTER_MS), true);
	});
});

describe("judges debate during a judgment day (terminal scene life T2, S2)", () => {
	const base = { v: 1, orchestrator: { state: "idle" }, context: { percent: null }, compaction: null, agents: [], ask: null, review: { phase: "idle", lenses: [], count: 0 } } as const;
	const judge = (status: string) => ({ v: 1, type: "subagent", id: "j" + status, agent: "jd-judge-a", role: "judge", label: "judge", status });
	const paint = (frame: Record<string, unknown>) => { const r = createRaster(HQ_WIDTH, HQ_HEIGHT); drawHq(r, frame); return r; };
	const P = (name: keyof typeof HQ_PALETTE) => HQ_PALETTE[name].toUpperCase();
	/* Bubble interiors above each judge's head (judges at x 560 and 668, heads from y 187). */
	const bubble = (r: { width: number; data: Uint8Array }, cx: number) => hex(r, cx + 1, 178);
	const gavelUp = (r: { width: number; data: Uint8Array }) => hex(r, 572, 195);
	const spark = (r: { width: number; data: Uint8Array }) => hex(r, 574, 190);

	it("a running jd-judge agent is a judgment day; a finished one is not", () => {
		assert.equal(frameFromSnapshot({ ...base, agents: [judge("running")] } as never).judging, true);
		assert.equal(frameFromSnapshot({ ...base, agents: [judge("completed")] } as never).judging, false);
	});

	it("the judges speak in turns: a bubble over one, then over the other", () => {
		const first = paint({ motion: true, t: 0, judging: true });
		const second = paint({ motion: true, t: 4, judging: true });
		assert.equal(bubble(first, 560), P("text"), "judge A speaks first");
		assert.notEqual(bubble(first, 668), P("text"));
		assert.equal(bubble(second, 668), P("text"), "then judge B");
		assert.notEqual(bubble(second, 560), P("text"));
	});

	it("no bubbles and a resting gavel when nobody judges, even while the room moves", () => {
		for (const t of [0, 4, 6]) {
			const r = paint({ motion: true, t });
			assert.notEqual(bubble(r, 560), P("text"));
			assert.notEqual(bubble(r, 668), P("text"));
			assert.notEqual(gavelUp(r), P("sand"), `t ${t}: the gavel rests`);
		}
	});

	it("the gavel rises and falls during the debate", () => {
		const frames = [0, 1, 2, 3, 4, 5, 6, 7].map(t => gavelUp(paint({ motion: true, t, judging: true })));
		assert.ok(frames.includes(P("sand")) && frames.some(c => c !== P("sand")), frames.join(" "));
	});

	it("when they finish the gavel strikes: down on its block with a gold spark", () => {
		const r = paint({ struck: true });
		assert.equal(spark(r), P("gold"));
		assert.notEqual(gavelUp(r), P("sand"));
		assert.notEqual(spark(paint({})), P("gold"), "no spark at rest");
	});

	it("the gavel clock: one strike of GAVEL_STRIKE_MS when the judging ends, none before or after", () => {
		const clock = gavelClock();
		assert.equal(clock.at(false, 0), false, "no judgment yet: no strike");
		assert.equal(clock.at(true, 1_000), false);
		assert.equal(clock.at(false, 2_000), true, "the judges finish: strike");
		assert.equal(clock.dueAt(), 2_000 + GAVEL_STRIKE_MS);
		assert.equal(clock.at(false, 2_000 + GAVEL_STRIKE_MS - 1), true);
		assert.equal(clock.at(false, 2_000 + GAVEL_STRIKE_MS), false, "then they rest");
		assert.equal(clock.at(false, 9_000), false, "only once");
	});
});

describe("the orchestrator at its monitor (terminal scene life T4, S4)", () => {
	const paint = (frame: Record<string, unknown>) => { const r = createRaster(HQ_WIDTH, HQ_HEIGHT); drawHq(r, frame); return r; };
	const P = (name: keyof typeof HQ_PALETTE) => HQ_PALETTE[name].toUpperCase();
	const skin = HQ_PALETTE.sand.toUpperCase();
	/* The monitor at the desk's left end (screen 323-335 x 90-100); the orchestrator stands left of it (cx 308, feet 112)
	   or rests behind the desk (cx 356, feet 112). */
	it("a monitor stands on the orchestrator's desk: dark while it rests, lit while it thinks or runs a tool", () => {
		assert.equal(hex(paint({}), 321, 95), P("border"), "monitor frame");
		assert.equal(hex(paint({}), 329, 95), P("bg"), "dark screen");
		assert.equal(hex(paint({ thinking: true }), 325, 93), P("blue"), "lit screen");
	});

	it("while it thinks it stands at the monitor with its back to us: no face there, none behind the desk", () => {
		const r = paint({ thinking: true });
		assert.equal(hex(r, 306, 89), P("hair"), "back of the head where the face would be");
		assert.notEqual(hex(r, 354, 89), skin, "nobody behind the desk");
	});

	it("while it waits or rests it stands behind the desk facing us, the cane at its side", () => {
		for (const frame of [{}, { waiting: true }]) {
			const r = paint(frame);
			assert.equal(hex(r, 354, 89), skin, `${JSON.stringify(frame)}: face behind the desk`);
			assert.equal(hex(r, 366, 98), P("gold"), `${JSON.stringify(frame)}: the cane's knob`);
			assert.notEqual(hex(r, 306, 89), P("hair"), `${JSON.stringify(frame)}: not at the monitor`);
		}
	});
});

describe("reviewer desks (terminal scene life T11, S10)", () => {
	const base = { v: 1, orchestrator: { state: "idle" }, context: { percent: null }, compaction: null, agents: [], ask: null } as const;
	const desks = (review: Record<string, unknown>) => frameFromSnapshot({ ...base, review } as never).reviewDesks;
	const paint = (frame: Record<string, unknown>) => { const r = createRaster(HQ_WIDTH, HQ_HEIGHT); drawHq(r, frame); return r; };
	const P = (name: keyof typeof HQ_PALETTE) => HQ_PALETTE[name].toUpperCase();

	it("desks follow the lens order risk, resilience, readability, reliability: the asked lenses light while they inspect", () => {
		assert.deepEqual(desks({ phase: "inspecting", lenses: ["reliability", "risk"], count: 2 }), ["lit", "off", "off", "lit"]);
		assert.deepEqual(desks({ phase: "approved", lenses: ["reliability", "risk"], count: 2 }), ["ok", "off", "off", "ok"]);
	});

	it("while the inspectors arrive every magnifier is still off", () => {
		assert.deepEqual(desks({ phase: "arriving", lenses: ["risk"], count: 0 }), ["off", "off", "off", "off"]);
	});

	it("with no lens names the first desks light, one per lens the capture runs", () => {
		assert.deepEqual(desks({ phase: "inspecting", lenses: [], count: 3 }), ["lit", "lit", "lit", "off"]);
		assert.deepEqual(desks({ phase: "approved", lenses: [], count: 1 }), ["ok", "off", "off", "off"]);
		assert.deepEqual(desks({ phase: "approved", lenses: [], count: 0 }), ["ok", "ok", "ok", "ok"], "approved with nothing known: every desk");
	});

	it("each desk has a magnifier at the front: dim when off, the lens colour when lit, a green check when approved", () => {
		const lens = ["red", "green", "blue", "gold"] as const;
		const off = paint({ reviewDesks: ["off", "off", "off", "off"] });
		const lit = paint({ reviewDesks: ["lit", "lit", "lit", "lit"] });
		const ok = paint({ reviewDesks: ["ok", "ok", "ok", "ok"] });
		for (let i = 0; i < 4; i++) {
			const x = 520 + i * 48;
			assert.equal(hex(off, x + 3, 114), P("dim"), `desk ${i}: off ring`);
			assert.equal(hex(lit, x + 3, 114), P(lens[i]), `desk ${i}: lit ring`);
			assert.equal(hex(ok, x + 3, 114), P(lens[i]), `desk ${i}: approved ring`);
			assert.equal(hex(ok, x + 19, 116), P("green"), `desk ${i}: check`);
			assert.notEqual(hex(lit, x + 19, 116), P("green"), `desk ${i}: no check before the approval`);
		}
		assert.equal(hex(paint({}), 523, 114), P("dim"), "no review: off");
	});
});

describe("Gentle HQ jukebox by the coffee machine (T11b)", () => {
	const paint = (frame: Record<string, unknown>) => { const r = createRaster(HQ_WIDTH, HQ_HEIGHT); drawHq(r, frame); return r; };
	const P = (name: keyof typeof HQ_PALETTE) => HQ_PALETTE[name].toUpperCase();
	/* The jukebox box: left of the counter (x 172), on the floor, clear of the telescope (x 120-140). */
	const box = (r: { width: number; data: Uint8Array }) => {
		const out: string[] = [];
		for (let y = 52; y < 124; y++) for (let x = 140; x < 172; x++) out.push(hex(r, x, y));
		return out.join(",");
	};

	it("the jukebox stands on the floor just left of the counter: pink body, gold marquee, ink screen", () => {
		const r = paint({});
		assert.equal(hex(r, 149, 86), P("gold"), "marquee");
		assert.equal(hex(r, 149, 97), P("bg"), "screen");
		assert.equal(hex(r, 147, 100), P("fdeep"), "body beside the screen");
	});

	it("its old spot under the room's bottom right is free again: floor there", () => {
		const floor = [HQ_PALETTE.floorA, HQ_PALETTE.floorB, HQ_PALETTE.seam].map(c => c.toUpperCase());
		assert.ok(floor.includes(hex(paint({ motion: true, t: 1 }), 160, 330)), "no jukebox at 160, 330");
		assert.ok(floor.includes(hex(paint({ motion: true, t: 1 }), 186, 366)), "no jukebox at 186, 366");
	});

	it("still while the room is still: the bars and notes stay put with motion off", () => {
		assert.equal(box(paint({ motion: false, t: 0 })), box(paint({ motion: false, t: 3 })));
	});

	it("its notes float up only while motion is on", () => {
		assert.notEqual(box(paint({ motion: true, t: 0 })), box(paint({ motion: true, t: 3 })));
	});
});

describe("the Boss (terminal scene life T5, S5)", () => {
	const paint = (frame: Record<string, unknown>) => { const r = createRaster(HQ_WIDTH, HQ_HEIGHT); drawHq(r, frame); return r; };
	const P = (name: keyof typeof HQ_PALETTE) => HQ_PALETTE[name].toUpperCase();
	const FLOOR = ["floorA", "floorB", "seam"].map(name => P(name as keyof typeof HQ_PALETTE));
	/* The Boss (person() at cx, feet fy): by the door while everything is still, in front of the orchestrator's desk
	   while it thinks. Offsets are from the sprite's feet, so the checks follow the sprite, not the room. */
	const DOOR = { cx: 360, fy: 378 }, DESK = { cx: 364, fy: 166 };
	const boss = (spot: { cx: number; fy: number }) => {
		const { cx, fy } = spot;
		return [
			/* Black hoodie, hood up: the hood's top and sides, the coat under the chin, the B's stem and its counter. */
			{ at: [cx, fy - 28], want: P("hair"), what: "hood top" },
			{ at: [cx - 5, fy - 22], want: P("hair"), what: "hood side (no face there)" },
			{ at: [cx - 5, fy - 10], want: P("hair"), what: "black hoodie on the chest" },
			{ at: [cx - 1, fy - 14], want: P("hair"), what: "the B's counter" },
			/* Fuchsia B on the chest: stem, and the right bump. */
			{ at: [cx - 2, fy - 15], want: P("fuchsia"), what: "the B's stem" },
			{ at: [cx + 1, fy - 14], want: P("fuchsia"), what: "the B's right bump" },
			/* White shorts above the knee, bare legs below, white sneakers. */
			{ at: [cx - 3, fy - 6], want: P("text"), what: "white shorts" },
			{ at: [cx + 2, fy - 5], want: P("text"), what: "white shorts, right leg" },
			{ at: [cx - 3, fy - 3], want: P("sand"), what: "bare leg" },
			{ at: [cx + 2, fy - 4], want: P("sand"), what: "bare leg, right" },
			{ at: [cx - 4, fy - 1], want: P("text"), what: "white sneaker" },
			{ at: [cx + 2, fy - 1], want: P("text"), what: "white sneaker, right" },
			/* Keyboard in the right hand: a light bar with key dots, the hand under its left end. */
			{ at: [cx + 8, fy - 12], want: P("text"), what: "keyboard light bar" },
			{ at: [cx + 7, fy - 11], want: P("muted"), what: "keyboard key dot" },
			{ at: [cx + 4, fy - 10], want: P("sand"), what: "hand on the keyboard" },
		];
	};
	const check = (r: ReturnType<typeof paint>, spot: { cx: number; fy: number }, label: string) => {
		for (const { at: [x, y], want, what } of boss(spot)) assert.equal(hex(r, x!, y!), want, `${label}: ${what} at ${x},${y}`);
	};

	it("while everything is still the Boss stands by the door, with or without motion", () => {
		check(paint({}), DOOR, "idle");
		check(paint({ t: 1, motion: true, waiting: true }), DOOR, "waiting, motion");
	});

	it("while the orchestrator thinks the Boss stands in front of its desk", () => {
		check(paint({ thinking: true }), DESK, "thinking");
		check(paint({ t: 1, motion: true, thinking: true }), DESK, "thinking, motion");
	});

	it("the other spot is floor: by the door while it thinks, in front of the desk while it is still", () => {
		assert.ok(FLOOR.includes(hex(paint({ thinking: true }), DOOR.cx - 5, DOOR.fy - 10)), "door spot empty while thinking");
		assert.ok(FLOOR.includes(hex(paint({}), DESK.cx - 5, DESK.fy + 10)), "desk spot empty while still");
	});
});
