import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { encodePng } from "../src/stage/png.ts";
import { createRaster } from "../src/stage/raster.ts";
import { frameFromSnapshot, renderHqPng, renderPortraitPng } from "../src/stage/frame.ts";
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
		assert.equal(hex(r, 296, 92), HQ_PALETTE.pink.toUpperCase(), "suit");
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
	const base = { v: 1, orchestrator: { state: "idle" }, context: { percent: null }, compaction: null, agents: [], ask: null } as const;
	const agent = (role: string, status: string) => ({ v: 1, type: "subagent", id: role + status, agent: "gentle-ai-" + role, role, label: role, status });

	it("an idle session is a still room with a full pot", () => {
		assert.deepEqual(frameFromSnapshot(base as never), { motion: false, thinking: false, waiting: false, working: false, exploring: false, context: null, brewing: false });
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
		assert.equal(frame.exploring, false, "a finished explorer no longer acts");
		assert.equal(frame.context, 38);
		assert.equal(frame.brewing, true);
	});

	it("a tool call counts as thinking (the orchestrator is at the board)", () => {
		assert.equal(frameFromSnapshot({ ...base, orchestrator: { state: "tool", toolName: "read" } } as never).thinking, true);
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
