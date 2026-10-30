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

export function createRaster(width: number, height: number): Raster {
	const data = new Uint8Array(width * height * 4);
	for (let i = 3; i < data.length; i += 4) data[i] = 255;
	return {
		width,
		height,
		data,
		fillStyle: "#000000",
		globalAlpha: 1,
		fillRect(x, y, w, h) {
			const value = Number.parseInt(this.fillStyle.slice(1, 7), 16);
			if (!/^#[0-9a-fA-F]{6}$/.test(this.fillStyle) || Number.isNaN(value)) return;
			const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
			const a = Math.min(1, Math.max(0, this.globalAlpha));
			const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
			const x1 = Math.min(width, Math.round(x + w)), y1 = Math.min(height, Math.round(y + h));
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
	for (let y = 0; y < out.height; y++) {
		const sy = Math.floor(y / factor);
		for (let x = 0; x < out.width; x++) {
			const si = (sy * source.width + Math.floor(x / factor)) * 4, oi = (y * out.width + x) * 4;
			out.data[oi] = source.data[si]!; out.data[oi + 1] = source.data[si + 1]!; out.data[oi + 2] = source.data[si + 2]!; out.data[oi + 3] = 255;
		}
	}
	return out;
}
