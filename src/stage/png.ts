import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
	return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let c = ~0;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
	return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, "latin1");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

/**
 * Encodes 8-bit RGBA pixels as a PNG with Node's own zlib, so the terminal stage needs no native image dependency.
 * Kitty graphics in pi-tui accept PNG only (`encodeKitty` sends f=100). Level 1 deflate: frames are redrawn a few times a
 * second while someone acts, and flat pixel art compresses well even at the fastest level.
 */
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
	if (rgba.length !== width * height * 4) throw new Error(`expected ${width * height * 4} RGBA bytes for ${width}x${height}, got ${rgba.length}`);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const stride = width * 4;
	const rows = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}
