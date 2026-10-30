import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { encodePng } from "../src/stage/png.ts";
import { createRaster } from "../src/stage/raster.ts";
import { renderHqPng } from "../src/stage/frame.ts";
import { HQ_HEIGHT, HQ_PALETTE, HQ_WIDTH, drawHq } from "../web/hq-scene.js";

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

describe("stage frame", () => {
	it("renders the room as a base64 PNG at 2x, so the terminal never has to upscale it", () => {
		const png = Buffer.from(renderHqPng({ t: 0, motion: false }), "base64");
		const ihdr = chunks(png)[0]!.data;
		assert.equal(ihdr.readUInt32BE(0), HQ_WIDTH * 2);
		assert.equal(ihdr.readUInt32BE(4), HQ_HEIGHT * 2);
	});
});
