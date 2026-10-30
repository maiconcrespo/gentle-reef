/**
 * The part of CanvasRenderingContext2D the Gentle HQ room uses (web/hq-scene.js): `fillStyle` as #rrggbb,
 * `globalAlpha`, and `fillRect`. Pixels are 8-bit RGBA, starting opaque black.
 */
export interface Raster {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
	fillStyle: string;
	globalAlpha: number;
	fillRect(x: number, y: number, w: number, h: number): void;
}

/** #rrggbb to [r, g, b], cached: the room uses a few dozen colours thousands of times per frame. */
const RGB_CACHE = new Map<string, readonly [number, number, number] | null>();
function rgbOf(style: string): readonly [number, number, number] | null {
	let rgb = RGB_CACHE.get(style);
	if (rgb === undefined) {
		rgb = /^#[0-9a-fA-F]{6}$/.test(style) ? [Number.parseInt(style.slice(1, 3), 16), Number.parseInt(style.slice(3, 5), 16), Number.parseInt(style.slice(5, 7), 16)] : null;
		RGB_CACHE.set(style, rgb);
	}
	return rgb;
}
/* One RGBA pixel as a native-endian 32-bit word, so an opaque fill is a Uint32Array.fill per row. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const word = (r: number, g: number, b: number): number => (LITTLE_ENDIAN ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0);

export function createRaster(width: number, height: number): Raster {
	const data = new Uint8Array(width * height * 4);
	const words = new Uint32Array(data.buffer);
	words.fill(word(0, 0, 0));
	return {
		width,
		height,
		data,
		fillStyle: "#000000",
		globalAlpha: 1,
		fillRect(x, y, w, h) {
			const rgb = rgbOf(this.fillStyle);
			if (rgb === null) return;
			const a = Math.min(1, Math.max(0, this.globalAlpha));
			const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
			const x1 = Math.min(width, Math.round(x + w)), y1 = Math.min(height, Math.round(y + h));
			if (x1 <= x0 || y1 <= y0 || a === 0) return;
			if (a === 1) {
				const value = word(rgb[0], rgb[1], rgb[2]);
				for (let py = y0; py < y1; py++) words.fill(value, py * width + x0, py * width + x1);
				return;
			}
			for (let py = y0; py < y1; py++) {
				for (let px = x0; px < x1; px++) {
					const i = (py * width + px) * 4;
					for (let k = 0; k < 3; k++) data[i + k] = Math.round(data[i + k]! + (rgb[k]! - data[i + k]!) * a);
					data[i + 3] = 255;
				}
			}
		},
	};
}

/** Nearest-neighbour upscale by a whole factor, so pixels stay square when the terminal shows the image. */
export function upscale(source: Raster, factor: number): Raster {
	const out = createRaster(source.width * factor, source.height * factor);
	const src = new Uint32Array(source.data.buffer, source.data.byteOffset, source.width * source.height);
	const dst = new Uint32Array(out.data.buffer);
	for (let sy = 0; sy < source.height; sy++) {
		const row = sy * factor * out.width;
		for (let sx = 0; sx < source.width; sx++) dst.fill(src[sy * source.width + sx]!, row + sx * factor, row + (sx + 1) * factor);
		for (let k = 1; k < factor; k++) dst.copyWithin(row + k * out.width, row, row + out.width);
	}
	return out;
}
