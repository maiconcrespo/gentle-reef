// Gentle HQ room (design/reef-quest/02-gentle-hq.html), drawn with fillRect only so the same code paints a browser
// canvas and the Node raster behind the terminal stage. Pure: no DOM, no timers; the caller passes the frame.
// Plain ES module on purpose, like scene-reducer.js: the browser loads it as-is and Node imports it.

export const HQ_WIDTH = 720;
export const HQ_HEIGHT = 408;

/* Palette: the Gentleman-Cute tokens (design/system.md) plus the engine's fuchsia; shade/hi mix toward plum/text like the engine. */
export const HQ_PALETTE = {
	bg: '#060407', panel: '#100A0F', user: '#2A1523', sel: '#28121E', border: '#563040', text: '#F6EFF3', muted: '#A78E9B', dim: '#76616B',
	gold: '#E0C27A', blue: '#A9C7EE', green: '#B4E7C7', red: '#FF718F', pink: '#F095C8', sand: '#F2B86D', fuchsia: '#FF1F9D', fdeep: '#C2107A',
	deep: '#C96AA2', floorA: '#8C6272', floorB: '#876072', seam: '#6E4D5C', hair: '#16101A'
};
const K = HQ_PALETTE;
const mix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const shade = c => mix(c, K.user, 0.4), hi = c => mix(c, K.text, 0.3);
const INK = K.bg, SKIN = K.sand, SKIN_SH = shade(K.sand);
const W = HQ_WIDTH, H = HQ_HEIGHT;

/* The frame being painted. Set by drawHq for the duration of one synchronous call. */
let g = null, motion = false, t = 0, potLevel = 1, brewing = false, oddStep = null, todo = [], jobs = [], reviewDesks = [], judging = false, struck = false;
const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const O = (x, y, w, h, c) => { R(x - 1, y - 1, w + 2, h + 2, INK); R(x, y, w, h, c); };

/* ---------- room shell ---------- */
function floor() {
	for (let y = 60; y < H; y += 6) {
		const row = (y - 60) / 6;
		R(0, y, W, 6, row % 2 ? K.floorB : K.floorA);
		R(0, y + 5, W, 1, K.seam);
		for (let x = (row * 37) % 64; x < W; x += 64) R(x, y, 1, 5, K.seam);
	}
	/* Archive wing: darker boards. */
	for (let y = 60; y < 300; y += 6) { R(0, y, 216, 6, (y / 6) % 2 ? shade(K.floorB) : shade(K.floorA)); R(0, y + 5, 216, 1, shade(K.seam)); }
	/* Review wing: courthouse checker tiles. */
	for (let y = 60; y < H; y += 12) for (let x = 510; x < W; x += 12) R(x, y, 12, 12, ((x - 510) / 12 + (y - 60) / 12) % 2 ? K.user : K.sel);
	/* Office: pink rug under the orchestrator's desk. */
	O(286, 92, 148, 58, K.deep); R(290, 96, 140, 50, K.pink); R(294, 100, 132, 42, K.deep);
	for (let x = 298; x < 424; x += 8) { R(x, 104, 4, 2, K.pink); R(x + 4, 136, 4, 2, K.pink); }
}
function walls() {
	R(0, 0, W, 6, K.border); R(0, 6, W, 38, K.sel);
	for (let x = 0; x < W; x += 16) R(x + 7, 6, 2, 38, K.user);
	R(0, 44, W, 4, K.border); R(0, 48, W, 12, K.panel);
	for (let x = 0; x < W; x += 12) R(x, 50, 1, 10, K.border);
	R(0, 58, W, 2, INK);
	/* Partitions with doorways. */
	const part = (x, y1, y2) => { O(x, y1, 4, y2 - y1, K.border); R(x, y1, 4, 2, K.muted); };
	part(214, 60, 160); part(214, 214, 300);
	part(506, 60, 150); part(506, 196, 288); part(506, 340, 408);
	/* Bottom wall with the front door. */
	R(0, 400, 336, 8, K.border); R(384, 400, 336, 8, K.border); R(0, 400, W, 1, INK);
	O(336, 398, 48, 10, K.user); R(344, 402, 32, 6, K.gold);
}
function plant(x, y) {
	O(x, y - 8, 10, 8, K.sand); R(x, y - 8, 10, 2, K.gold);
	const L = [[1, -18, 3, 10], [4, -22, 3, 14], [7, -17, 3, 9], [-2, -14, 3, 6], [10, -13, 3, 5]];
	for (const [lx, ly, lw, lh] of L) { R(x + lx, y + ly, lw, lh, K.green); R(x + lx + lw - 1, y + ly, 1, lh, shade(K.green)); }
}

/* ---------- people: 12 px wide, about 28 px tall, feet at (cx, fy) ---------- */
function person(cx, fy, o, bob = 0) {
	fy -= bob;
	g.globalAlpha = 0.35; R(cx - 7, fy + bob - 1, 14, 3, INK); g.globalAlpha = 1;
	if (!o.seated) {
		O(cx - 4, fy - 7, 3, 6, o.pants); O(cx + 1, fy - 7, 3, 6, o.pants);
		R(cx - 5, fy - 2, 4, 2, o.shoes || INK); R(cx + 1, fy - 2, 4, 2, o.shoes || INK);
	}
	O(cx - 6, fy - 17, 12, 10, o.coat); R(cx + 4, fy - 17, 2, 10, shade(o.coat)); R(cx - 6, fy - 17, 1, 10, hi(o.coat));
	O(cx - 8, fy - 16, 2, 8, o.coat); O(cx + 6, fy - 16, 2, 8, o.coat);
	R(cx - 8, fy - 8, 2, 2, SKIN); R(cx + 6, fy - 8, 2, 2, SKIN);
	O(cx - 5, fy - 27, 10, 10, SKIN); R(cx + 3, fy - 27, 2, 10, SKIN_SH);
	R(cx - 3, fy - 23, 1, 2, INK); R(cx + 2, fy - 23, 1, 2, INK);
	R(cx - 4, fy - 20, 1, 1, K.pink); R(cx + 3, fy - 20, 1, 1, K.pink);
	if (o.hair) { R(cx - 5, fy - 27, 10, 3, o.hair); R(cx - 5, fy - 25, 1, 4, o.hair); R(cx + 4, fy - 25, 1, 4, o.hair); }
	if (o.extra) o.extra(cx, fy);
}
/* The orchestrator: pink suit, black top hat with a gold band and a fuchsia rose, handlebar mustache, monocle, cane. */
const ORCH = { coat: K.pink, pants: K.deep, shoes: INK, hair: K.hair, extra(cx, fy) {
	R(cx - 2, fy - 17, 4, 7, K.text); R(cx - 3, fy - 17, 1, 6, K.deep); R(cx + 2, fy - 17, 1, 6, K.deep);
	R(cx - 2, fy - 17, 4, 2, K.fuchsia); R(cx - 1, fy - 17, 2, 2, K.fdeep);
	R(cx - 1, fy - 12, 1, 1, K.gold); R(cx - 1, fy - 10, 1, 1, K.gold);
	R(cx - 5, fy - 15, 2, 2, K.fuchsia);
	O(cx - 4, fy - 37, 8, 9, K.hair); O(cx - 7, fy - 29, 14, 2, K.hair); R(cx - 4, fy - 31, 8, 2, K.gold);
	R(cx + 1, fy - 35, 3, 3, K.fuchsia); R(cx + 2, fy - 34, 1, 1, K.fdeep); R(cx + 4, fy - 33, 2, 1, K.green);
	R(cx - 5, fy - 20, 3, 1, K.fuchsia); R(cx + 2, fy - 20, 3, 1, K.fuchsia); R(cx - 6, fy - 21, 1, 1, K.fuchsia); R(cx + 5, fy - 21, 1, 1, K.fuchsia); R(cx - 2, fy - 20, 4, 1, K.fdeep);
	R(cx + 1, fy - 25, 3, 1, K.gold); R(cx + 1, fy - 21, 3, 1, K.gold); R(cx, fy - 24, 1, 3, K.gold); R(cx + 4, fy - 24, 1, 3, K.gold); R(cx + 4, fy - 20, 1, 5, K.gold);
	R(cx + 10, fy - 13, 1, 13, INK); R(cx + 9, fy - 14, 3, 2, K.gold);
} };
const EXPLORER = { coat: K.blue, pants: K.sand, hair: K.gold, extra(cx, fy) {
	R(cx - 6, fy - 30, 12, 4, K.sand); R(cx - 7, fy - 27, 14, 1, shade(K.sand)); R(cx - 1, fy - 30, 2, 1, K.green);
	R(cx - 6, fy - 13, 12, 2, shade(K.sand));
	O(cx + 8, fy - 11, 4, 5, K.gold); R(cx + 9, fy - 10, 2, 3, K.text);
} };
const worker = hair => ({ coat: K.green, pants: K.border, hair, seated: true, extra(cx, fy) {
	R(cx - 3, fy - 17, 6, 10, shade(K.green)); R(cx - 3, fy - 17, 1, 3, K.text); R(cx + 2, fy - 17, 1, 3, K.text);
	R(cx - 6, fy - 26, 1, 5, INK); R(cx + 5, fy - 26, 1, 5, INK); R(cx - 5, fy - 29, 10, 1, INK); R(cx - 7, fy - 22, 2, 2, K.fuchsia);
} });
/* A worker on a coffee break: standing, a cup in the right hand. */
const onBreak = hair => { const w = worker(hair); return { ...w, seated: false, extra(cx, fy) { w.extra(cx, fy); O(cx + 6, fy - 11, 3, 4, K.text); R(cx + 9, fy - 10, 1, 2, K.text); } }; };
const reviewer = lens => ({ coat: K.border, pants: K.user, hair: K.hair, extra(cx, fy) {
	O(cx - 5, fy - 31, 10, 4, K.hair); O(cx - 7, fy - 28, 14, 1, K.hair); R(cx - 5, fy - 29, 10, 1, lens);
	R(cx - 4, fy - 14, 3, 3, lens);
	R(cx + 8, fy - 13, 1, 4, K.sand); O(cx + 7, fy - 17, 4, 4, K.blue);
} });
const JUDGE = { coat: K.hair, pants: K.hair, extra(cx, fy) {
	R(cx - 6, fy - 29, 12, 4, K.text); R(cx - 7, fy - 27, 2, 8, K.text); R(cx + 5, fy - 27, 2, 8, K.text);
	R(cx - 7, fy - 25, 2, 1, K.muted); R(cx + 5, fy - 23, 2, 1, K.muted);
	R(cx - 2, fy - 17, 4, 3, K.text); R(cx - 1, fy - 14, 2, 1, K.gold);
} };
const VERIFIER = { coat: K.text, pants: K.border, hair: K.border, seated: true, extra(cx, fy) {
	R(cx - 6, fy - 17, 1, 10, K.pink); R(cx + 5, fy - 17, 1, 10, K.pink); R(cx - 1, fy - 17, 2, 4, K.pink);
	O(cx - 5, fy - 27, 10, 2, K.blue); R(cx - 3, fy - 27, 2, 2, K.text); R(cx + 1, fy - 27, 2, 2, K.text);
} };
const FIXER = { coat: K.sand, pants: K.border, hair: K.deep, extra(cx, fy) {
	R(cx - 3, fy - 17, 6, 10, shade(K.sand)); O(cx + 8, fy - 14, 2, 8, K.muted); R(cx + 7, fy - 15, 4, 2, K.muted);
} };

/* ---------- objects ---------- */
function engramVault() {
	/* Engram drawers: a compact cabinet; drawer #417 glows after a save, the owl answers mem_search. */
	O(8, 10, 58, 70, shade(K.sand)); R(8, 10, 58, 3, K.gold);
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
		const x = 12 + c * 18, y = 16 + r * 21;
		O(x, y, 16, 18, K.sand); R(x, y, 16, 2, hi(K.sand)); R(x + 5, y + 8, 6, 3, K.border); R(x + 6, y + 9, 4, 1, K.gold);
	}
	R(30, 75, 16, 1, motion && t % 4 < 2 ? K.fuchsia : K.fdeep);
	O(48, 0, 12, 10, K.muted); R(50, 2, 3, 3, K.text); R(55, 2, 3, 3, K.text); R(51, 3, 1, 1, INK); R(56, 3, 1, 1, INK); R(53, 6, 2, 2, K.gold);
}

function windowWithTelescope() {
	/* The window shows the codegraph sky: symbols are stars, calls are lines. A small telescope by it is web search. */
	O(84, 6, 84, 38, K.border); R(86, 8, 80, 34, INK);
	const N = [[94, 16], [110, 12], [130, 20], [116, 28], [146, 14], [150, 32], [100, 34]];
	for (const [a, b] of [[0, 1], [1, 2], [1, 3], [2, 4], [2, 5], [3, 6], [3, 5]]) {
		const [x1, y1] = N[a], [x2, y2] = N[b], n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
		for (let i = 0; i <= n; i += 2) R(Math.round(x1 + (x2 - x1) * i / n), Math.round(y1 + (y2 - y1) * i / n), 1, 1, shade(K.blue));
	}
	N.forEach(([x, y], i) => R(x - 1, y - 1, 3, 3, motion && i === t % N.length ? K.gold : K.blue));
	R(125, 8, 2, 34, K.border); O(82, 44, 88, 2, K.border);
	R(130, 70, 1, 18, INK); R(138, 70, 1, 18, INK); R(134, 70, 1, 20, INK);
	O(124, 62, 16, 5, K.gold); O(120, 61, 4, 7, K.sand); R(124, 62, 16, 1, hi(K.gold));
}

function codegraphBoard() {}

function mapTable() {
	O(16, 104, 52, 22, shade(K.sand)); R(16, 104, 52, 2, hi(K.sand));
	O(20, 107, 44, 15, K.text);
	for (let i = 0; i < 6; i++) R(24 + i * 6, 111 + (i % 3) * 3, 3, 1, K.red);
	R(54, 114, 3, 3, K.fuchsia); R(26, 119, 22, 1, K.blue);
	R(19, 126, 2, 6, INK); R(63, 126, 2, 6, INK);
}

function designEasel() {
	R(24, 172, 2, 16, INK); R(38, 172, 2, 16, INK); R(31, 170, 2, 18, INK);
	O(18, 148, 28, 22, K.text); R(21, 151, 22, 16, hi(K.pink));
	R(23, 153, 9, 6, K.pink); R(34, 156, 7, 9, K.blue); R(23, 161, 8, 4, K.gold);
	O(16, 170, 32, 2, shade(K.sand));
}

function coffeeCorner() {
	/* The coffee corner by the window (T4f): a small counter against the wall, the espresso machine and the pot. The pot is the
	   context window: it drains as context fills, and the machine steams while a compaction brews. Up here the dialog never covers it. */
	O(172, 62, 38, 10, shade(K.sand)); R(172, 62, 38, 2, hi(K.sand)); R(174, 72, 2, 6, INK); R(206, 72, 2, 6, INK);
	O(176, 44, 14, 18, K.muted); R(176, 44, 14, 3, K.text); R(179, 50, 8, 4, INK); R(181, 56, 4, 3, INK); R(182, 59, 2, 2, K.text);
	if (motion || brewing) for (let i = 0; i < 3; i++) R(178 + i * 4, 40 - ((t + i * 2) % 6), 2, 2, K.text);
	/* Pot gauge: drains as context fills (level = 1 - percent / 100); full while the percent is unknown. */
	O(194, 50, 10, 16, K.panel);
	const fill = Math.round(12 * potLevel), top = 64 - fill;
	if (fill > 0) { R(196, top, 6, fill, K.sand); R(196, top, 6, Math.min(2, fill), K.gold); }
	O(206, 56, 3, 4, K.text);
}
function jukebox() {
	/* Standing on the floor just left of the coffee counter (T11b): 22 x 34, the same colours as before. The equaliser bars and the notes move only while the room does. */
	const x = 146, y = 84;
	O(x, y, 22, 34, K.fdeep); R(x, y, 22, 8, K.pink); R(x + 3, y + 2, 16, 4, K.gold);
	R(x + 3, y + 11, 16, 12, INK);
	for (let i = 0; i < 4; i++) {
		const bar = motion ? 3 + ((t + i) % 3) * 3 : 6;
		R(x + 4 + i * 4, y + 22 - bar, 3, bar, [K.blue, K.green, K.pink, K.gold][i]);
	}
	R(x + 2, y + 24, 18, 8, shade(K.fdeep));
	if (motion) { const ny = y - 4 - (t % 8) * 2; R(x + 24, ny, 2, 6, K.gold); R(x + 26, ny, 3, 2, K.gold); R(x - 4, ny + 6, 2, 6, K.pink); R(x - 7, ny + 10, 3, 2, K.pink); }
}
function chalkboard() {
	O(266, 6, 188, 50, shade(K.sand)); R(266, 6, 188, 2, hi(K.sand));
	R(270, 10, 180, 42, '#0E0A0E');
	R(272, 12, 176, 38, INK);
	/* The ODD steps in chalk, two columns: a marker and a scribble per step. Done green, current gold and underlined, later muted. */
	for (let i = 0; i < 7; i++) {
		/* Lower on the board: the project sign hangs over its top edge (T4f). */
		const x = 276 + Math.floor(i / 4) * 88, y = 22 + (i % 4) * 8;
		const c = oddStep === null ? K.text : i < oddStep ? K.green : i === oddStep ? K.gold : K.muted;
		R(x, y, 4, 4, c);
		R(x + 7, y + 1, 18 + ((i * 11) % 5) * 9, 2, c);
		if (i === oddStep) R(x + 7, y + 5, 40, 1, K.gold);
	}
	O(290, 56, 140, 3, shade(K.sand));
	R(300, 54, 6, 2, K.text); R(312, 54, 4, 2, K.pink); R(410, 53, 10, 3, K.muted);
}
function featureDesk() {
	O(320, 108, 96, 22, shade(K.sand)); R(320, 108, 96, 3, hi(K.sand)); R(324, 130, 4, 8, INK); R(408, 130, 4, 8, INK);
	/* Feature document scroll and the Engram mirror stamp. */
	O(334, 100, 34, 12, K.text); R(334, 100, 34, 2, K.sand); for (let i = 0; i < 4; i++) R(338, 104 + i * 2, 20 - i * 4, 1, K.muted); R(360, 106, 5, 4, K.fuchsia);
	/* Quill and inkwell. */
	O(374, 104, 6, 6, INK); R(378, 94, 1, 12, K.text); R(379, 94, 3, 5, K.pink);
	/* Bell: audio notifications. */
	O(392, 102, 12, 6, K.gold); R(396, 98, 4, 4, K.gold); R(397, 97, 2, 1, K.sand);
	if (motion && t % 8 < 2) { R(388, 96, 2, 1, K.gold); R(406, 96, 2, 1, K.gold); }
}
function profileRack() {
	R(452, 70, 3, 52, INK); O(444, 120, 19, 3, INK);
	R(446, 72, 16, 2, INK);
	/* Hats = profiles: top hat, cap, beret. */
	O(442, 60, 8, 8, K.hair); O(440, 67, 12, 2, K.hair); R(442, 64, 8, 1, K.gold);
	O(456, 64, 9, 5, K.blue); R(456, 68, 11, 1, shade(K.blue));
	O(447, 78, 10, 4, K.fuchsia);
}
function mailTube() {
	O(476, 0, 8, 96, K.muted); R(477, 0, 2, 96, hi(K.muted));
	O(470, 96, 20, 22, K.border); R(474, 100, 12, 10, INK);
	const y = motion ? (t * 9) % 90 : 40; O(477, y, 6, 8, K.gold);
	R(472, 112, 16, 3, K.green);
}
function questBoard() {
	/* The TODO board: one row per task, coloured by state (rows drawn in questBoard from the frame). */
	O(98, 144, 110, 62, shade(K.sand)); R(101, 147, 104, 56, K.sand); R(101, 147, 104, 2, hi(K.sand));
	R(104, 150, 98, 50, mix(K.sand, K.text, 0.55));
	R(106, 148, 3, 3, K.red); R(196, 148, 3, 3, K.red);
	/* One row per task (first four): done is a green box, the current one a fuchsia box with a longer line, pending an outline. */
	todo.slice(0, 4).forEach((task, i) => {
		const y = 153 + i * 11;
		if (task.done) R(108, y, 4, 4, K.green);
		else if (task.now) R(108, y, 4, 4, K.fuchsia);
		else { R(108, y, 4, 1, K.border); R(108, y + 3, 4, 1, K.border); R(108, y, 1, 4, K.border); R(111, y, 1, 4, K.border); }
		R(116, y + 1, task.now ? 70 : 40 + ((i * 13) % 4) * 8, 2, task.done ? K.green : task.now ? K.fdeep : K.muted);
	});
	R(112, 206, 2, 12, INK); R(192, 206, 2, 12, INK);
}

function draftingDesk(x, working) {
	O(x, 222, 64, 16, shade(K.sand)); R(x, 222, 64, 3, hi(K.sand)); R(x + 4, 238, 3, 10, INK); R(x + 57, 238, 3, 10, INK);
	O(x + 4, 206, 26, 18, K.border); R(x + 6, 208, 22, 14, INK);
	/* S3: code scrolls only while this desk's worker works; otherwise a still game: hero on green ground, a coin, a block. */
	if (working) for (let i = 0; i < 4; i++) R(x + 8, 210 + i * 3, ((t + i + x) % 4) * 4 + 4, 1, K.green);
	else {
		R(x + 6, 219, 22, 3, K.green); R(x + 6, 219, 22, 1, hi(K.green));
		R(x + 10, 214, 3, 5, K.fuchsia); R(x + 10, 213, 3, 1, K.sand);
		R(x + 18, 211, 2, 2, K.gold); O(x + 23, 213, 4, 4, K.sand);
	}
	R(x + 15, 224, 4, 2, K.border);
	O(x + 36, 226, 12, 4, K.text); R(x + 50, 225, 6, 5, K.pink);
}
function doorAndPermissions() {
	/* Permission mode is a brass plaque on the wall by the door, not a street light. */
	O(392, 389, 34, 9, K.gold); R(394, 391, 30, 5, K.panel); R(396, 392, 3, 3, K.green);
	O(338, 384, 44, 12, K.fdeep); R(342, 388, 36, 4, K.pink);
}

function installerCrates() {
	const crate = (x, y, c) => { O(x, y, 22, 18, shade(K.sand)); R(x, y, 22, 2, hi(K.sand)); R(x + 2, y + 8, 18, 2, shade(shade(K.sand))); R(x + 7, y + 4, 8, 4, c); };
	crate(240, 370, K.muted); crate(264, 370, K.blue); crate(252, 350, K.green);
}
function reviewStations() {
	const lenses = [K.red, K.green, K.blue, K.gold];
	lenses.forEach((c, i) => {
		const x = 520 + i * 48;
		O(x, 104, 30, 16, K.border); R(x, 104, 30, 3, c);
		R(x + 4, 110, 22, 1, K.muted);
		/* Desk lamp in the lens colour. */
		R(x + 24, 94, 1, 10, INK); O(x + 20, 90, 8, 4, c);
		if (motion) { g.globalAlpha = 0.18 + 0.08 * ((t + i) % 2); R(x + 14, 94, 20, 10, c); g.globalAlpha = 1; }
		/* Magnifier at the desk's front (S10): dim while off, the lens colour while it inspects, a green check once approved. */
		const desk = reviewDesks[i], ring = desk === 'lit' || desk === 'ok' ? c : K.dim;
		R(x + 4, 112, 6, 1, ring); R(x + 4, 117, 6, 1, ring); R(x + 3, 113, 1, 4, ring); R(x + 10, 113, 1, 4, ring);
		R(x + 4, 113, 6, 4, desk === 'off' || !desk ? INK : hi(c)); R(x + 11, 117, 3, 2, ring);
		if (desk === 'ok') { R(x + 17, 114, 2, 2, K.green); R(x + 19, 116, 2, 2, K.green); R(x + 21, 112, 2, 4, K.green); R(x + 23, 110, 2, 2, K.green); }
	});
}
/* A speech bubble with "…" over a judge's head (S2). */
function speechBubble(cx) {
	O(cx - 5, 172, 12, 9, K.text); R(cx - 1, 181, 2, 2, K.text);
	for (let i = 0; i < 3; i++) R(cx - 3 + i * 3, 176, 1, 1, INK);
}
function judgmentBench() {
	O(534, 210, 160, 30, K.hair); R(534, 210, 160, 4, K.border); R(538, 218, 152, 1, K.border);
	R(606, 214, 16, 20, K.fuchsia); R(608, 216, 12, 16, K.fdeep); R(612, 220, 4, 4, K.gold);
	/* Gavel on its block: it rises and falls only during a judgment day (S2); when the judges finish it strikes once, with a spark. */
	O(574, 204, 10, 4, shade(K.sand)); const up = motion && judging && !struck && t % 6 === 0;
	O(570, up ? 194 : 198, 10, 5, K.sand); R(578, up ? 196 : 200, 10, 2, shade(K.sand));
	if (struck) { R(570, 192, 1, 3, K.gold); R(574, 189, 2, 4, K.gold); R(579, 192, 1, 3, K.gold); }
	/* Two scales: A and B. */
	O(642, 200, 2, 10, K.gold); R(636, 200, 14, 1, K.gold); R(634, 202, 4, 2, K.gold); R(648, 202, 4, 2, K.gold);
}
function verifyLab() {
	O(520, 350, 180, 26, K.text); R(520, 350, 180, 3, K.muted); R(520, 370, 180, 6, K.muted);
	/* Test tubes: green means passing. */
	for (let i = 0; i < 6; i++) { const x = 530 + i * 9; O(x, 334, 4, 16, K.text); R(x, 342, 4, 8, i === 4 && t % 4 < 2 ? K.gold : K.green); }
	O(526, 348, 52, 3, K.border);
	/* Microscope. */
	O(660, 330, 6, 20, K.muted); O(654, 346, 18, 4, K.border); O(664, 326, 10, 5, K.muted);
	/* Check mark screen. */
	O(612, 326, 30, 22, K.border); R(614, 328, 26, 18, INK); R(620, 338, 3, 3, K.green); R(623, 341, 3, 3, K.green); R(626, 334, 3, 7, K.green); R(629, 331, 3, 4, K.green);
}
function jobsWall() {
	/* One screen per tool call since the user's last message (T4b): a sand bar while it runs, green when it worked, red
	   when it failed. Screens without a job are switched off, with a standby dot. */
	for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) {
		const x = 518 + c * 32, y = 8 + r * 22, job = jobs[r * 6 + c];
		O(x, y, 28, 18, K.border); R(x + 2, y + 2, 24, 14, INK);
		if (job === "running") { R(x + 4, y + 7, 20, 4, K.sel); R(x + 4, y + 7, motion ? 4 + (t * 3 + c) % 17 : 10, 4, K.sand); }
		else if (job === "ok") for (let i = 0; i < 3; i++) R(x + 4, y + 5 + i * 4, 20 - i * 6, 2, K.green);
		else if (job === "fail") for (let i = 0; i < 3; i++) R(x + 4, y + 5 + i * 4, 20 - i * 6, 2, K.red);
		else R(x + 22, y + 13, 2, 1, K.dim);
	}
}

/**
 * Paints one frame of the room at 1x (HQ_WIDTH x HQ_HEIGHT) on any context with `fillStyle`, `globalAlpha` and `fillRect`.
 * `frame.t` is the animation step (4 per second), `frame.motion` false draws a still frame, and the flags say who is acting:
 * `thinking`/`waiting` (the orchestrator), `working` (the writers), `exploring` (the explorer); `workers` running writers
 * (the first desks show code, the rest a still game) and `coffee` (the writers on a break at the coffee corner); `judging`
 * (a judgment day: the judges debate, the gavel moves) and `struck` (the judges just finished: the gavel strikes).
 * State shown: `context` percent (the coffee pot), `brewing` (compaction steam), `odd` (current ODD step, 0-6, on the
 * chalkboard), `todo` ([{ done, now }] rows on the TODO board), `jobs` ("running" | "ok" | "fail", one monitor each)
 * and `reviewDesks` ("off" | "lit" | "ok", one magnifier per lens desk). Readable text lives in the terminal UI, not the image.
 */
export function drawHq(ctx, frame = {}) {
	g = ctx; t = frame.t ?? 0; motion = frame.motion ?? false;
	const percent = typeof frame.context === 'number' && Number.isFinite(frame.context) ? Math.min(100, Math.max(0, frame.context)) : null;
	potLevel = percent === null ? 1 : 1 - percent / 100;
	brewing = frame.brewing === true;
	oddStep = Number.isInteger(frame.odd) ? frame.odd : null;
	todo = Array.isArray(frame.todo) ? frame.todo : [];
	jobs = Array.isArray(frame.jobs) ? frame.jobs : [];
	reviewDesks = Array.isArray(frame.reviewDesks) ? frame.reviewDesks : [];
	judging = frame.judging === true; struck = frame.struck === true;
	const bob = on => (motion && on ? t % 2 : 0);
	try {
		R(0, 0, W, H, K.panel);
		floor(); walls();
		engramVault(); windowWithTelescope(); chalkboard(); mailTube(); jobsWall();
		mapTable(); questBoard();
		person(82, 130, EXPLORER, bob(frame.exploring));
		designEasel(); coffeeCorner(); jukebox();
		profileRack(); featureDesk();
		person(300, 104, ORCH, bob(frame.thinking || frame.waiting));
		/* S3: the first `workers` desks work; on a coffee break the chairs are empty and the workers stand by the counter. */
		const workers = Number.isInteger(frame.workers) ? frame.workers : frame.working ? 3 : 0, coffee = frame.coffee === true;
		[[244, K.sand], [324, K.hair], [404, K.border]].forEach(([x, hair], i) => {
			if (!coffee) person(x + 46, 228, worker(hair), motion && i < workers && (t + i) % 2 === 0 ? 1 : 0);
			draftingDesk(x, i < workers);
		});
		if (coffee) [[182, 100, K.sand], [200, 100, K.hair], [191, 132, K.border]].forEach(([cx, fy, hair]) => person(cx, fy, onBreak(hair), 0));
		reviewStations();
		[K.red, K.green, K.blue, K.gold].forEach((c, i) => person(535 + i * 48, 100, reviewer(c), 0));
		person(560, 214, JUDGE, 0); person(668, 214, JUDGE, 0);
		judgmentBench();
		/* The judges debate in turns while a judgment day runs: one speaks for four steps, then the other. */
		if (motion && judging) speechBubble(Math.floor(t / 4) % 2 === 0 ? 560 : 668);
		person(600, 284, FIXER, 0);
		person(590, 354, VERIFIER, 0);
		verifyLab();
		installerCrates(); doorAndPermissions();
		plant(196, 300); plant(486, 140); plant(486, 396); plant(222, 300); plant(700, 300);
	} finally {
		g = null;
	}
}

/* The orchestrator's portrait for dialogs: hat, face and collar on a 24 x 24 context. */
export function drawHqPortrait(ctx) {
	g = ctx;
	try { person(12, 38, ORCH); } finally { g = null; }
}
