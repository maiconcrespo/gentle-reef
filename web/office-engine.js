/* Gentle Office engine: the 32-bit pixel-art office from design/agent-office/01-overworld-hq.html.
   Driven by a scene view (see scene-reducer.js sceneView). Resident subagents (T3) take the four desks and
   a waiting bench by the door; each desk monitor shows its agent's work while it runs. Browser module: no imports, no network. */

export const OFFICE_CONFIG = {
	cols: 20, rows: 13, tile: 24,
	desks: [{ x: 1, y: 4 }, { x: 5, y: 4 }, { x: 1, y: 8 }, { x: 5, y: 8 }],
	whiteboard: { x: 8, w: 4 }, coffee: { x: 16, y: 2, w: 3 }, table: { x: 11, y: 7, w: 4, h: 2 },
	rug: { x: 10, y: 5, w: 7, h: 6 }, window: { x: 1, w: 3 }, shelf: 13, clock: 6, door: { x: 9, w: 2 },
	plants: [{ x: 0, y: 2 }, { x: 19, y: 2 }, { x: 0, y: 12 }, { x: 19, y: 12 }], rack: { x: 19, y: 6 },
	orchStart: { x: 9, y: 5 }, front: { x: 8, y: 6 },
	bench: { x: 2, w: 6 }
};

const P = {
	bg: '#060407', panel: '#100A0F', user: '#2A1523', sel: '#28121E', border: '#563040',
	text: '#F6EFF3', muted: '#A78E9B', dim: '#76616B', gold: '#E0C27A', blue: '#A9C7EE', sky: '#C4DAF6',
	sec: '#D2CBD0', softRose: '#D7A0B8', green: '#B4E7C7', sand: '#F2B86D', red: '#FF718F',
	purple: '#F095C8', deep: '#C96AA2', violet: '#FFB1DD', steel: '#A78E9B', floorA: '#4A2A3A', floorB: '#563446',
	seam: '#0B070A', plum: '#2A1523', champagne: '#E0C27A'
};

/* Mix two #rrggbb colors; t=0 gives a, t=1 gives b. Used for 3-tone shading. */
export function goMix(a, b, t) {
	const p = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
	const A = p(a), B = p(b);
	return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const shade = c => goMix(c, '#2A1523', 0.4);
const hi = c => goMix(c, '#F6EFF3', 0.3);
const INK = '#060407';
const SKIN = '#F2B86D', SKIN_SH = goMix('#F2B86D', '#2A1523', 0.4);
const ORCH_COLOR = '#E0C27A', ORCH_HAIR = '#16101A';
const STACHE = '#FF1F9D', STACHE_S = '#C2107A';
const MONOCLE = '#0E0A0E', MONOCLE_H = '#3A2A34';
const C = {
	wood: P.sand, woodH: hi(P.sand), woodS: shade(P.sand),
	marble: P.text, marbleS: goMix(P.text, '#2A1523', 0.25),
	steelH: hi(P.steel), steelS: shade(P.steel),
	pink: P.purple, pinkS: P.deep, pinkH: P.violet,
	leaf: P.green, leafS: shade(P.green), leafH: hi(P.green),
	coffee: goMix(P.sand, '#2A1523', 0.3), coffeeH: goMix(P.sand, '#2A1523', 0.1)
};

/* Sprite box: SPRITE.w x SPRITE.h px, feet on the anchor row, hats extend above it. Head maps are 24x14 letter grids.
   K ink, H hair, h hair shade, l hair light, S skin, s skin shade, E eye, W glint, C cheek, M mouth.
   Front and back heads are drawn half-width and mirrored so both sides always match. */
export const SPRITE = { w: 24, h: 36, head: 14 };
const mirror = rows => rows.map(r => r + [...r].reverse().join(''));
const HEAD_DOWN = mirror([
	'......KKKKKK',
	'...KKHHHHHHH',
	'..KHHlHHHHHH',
	'.KHHHHHHHHHH',
	'.KHHHHHHSSSS',
	'.KHSSSSSSSSS',
	'..KSShhSSSSS',
	'..KSSWESSSSS',
	'..KSSEESSSSS',
	'..KCSSSSSSSs',
	'..KCSSSSSSSS',
	'...KSSSSSSMM',
	'...KSSSSSSSs',
	'....KKKKKKKK'
]);
const HEAD_UP = mirror([
	'......KKKKKK',
	'...KKHHHHHHH',
	'..KHHlHHHHHH',
	'.KHHlHHHHHHH',
	'.KHHHHHHHHHH',
	'.KHHHHHHHHHH',
	'.KHHHHHHHHHH',
	'.KHHHHHHHHHH',
	'..KHHHHHHHHH',
	'..KHHHHHHHHH',
	'...KhhhhhhhH',
	'....KHHHHHHH',
	'....KHHHHHHh',
	'....KKKKKKKK'
]);
/* Side view faces left; flipped at draw time for the right. */
const HEAD_SIDE = [
	'........KKKKKKKK........',
	'.......KHHHHHHHHK.......',
	'......KHHlHHHHHHHHK.....',
	'.....KHHHHHHHHHHHHK.....',
	'....KHHHHHHHHHHHHHHK....',
	'...KHHSSSSSSHHHHHHHK....',
	'...KSSSSSSSSSHHHHHHK....',
	'...KSSEWSSSSSHHHHHHK....',
	'...KSSESSSSSSHHHHHHK....',
	'...KsSSSSSSSSHHHHHHK....',
	'...KSSSSSSSSSHHHHHHK....',
	'....KSMSSSSSSHHHHHHK....',
	'....KSSSSSSSSSSK........',
	'......KKKKKKKKKK........'
];
export const HEAD_MAPS = { down: HEAD_DOWN, up: HEAD_UP, side: HEAD_SIDE };
const LEG = P.border, LEG_H = P.sel;

const triangle = v => { const f = v - Math.floor(v); return f < 0.5 ? f * 2 : 2 - f * 2; };
/* Stable hash of a task id: the same agent always gets the same look. */
const strHash = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

/** Draws the coffee pot in the sidebar. The fill is the remaining context (level 0..1). */
export function drawPot(ctx, level, t, brewing) {
	const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
	ctx.clearRect(0, 0, 32, 38);
	/* Glass carafe with a warm liquid level and a plum-tinted lid */
	R(12, 1, 8, 2, P.border); R(8, 3, 16, 3, P.border); R(9, 3, 14, 1, P.steel);
	R(3, 8, 3, 2, P.sec);
	R(5, 6, 22, 27, P.sec); R(6, 7, 20, 25, P.bg);
	const lv = Math.max(0, Math.min(1, level)), h = Math.round(24 * lv);
	if (h > 0) {
		const liquid = goMix(P.sand, P.plum, 0.3);
		R(7, 32 - h, 18, h, liquid); R(7, 32 - h, 18, 1, goMix(liquid, P.text, 0.3));
		if (h > 4) for (let i = 0; i < 3; i++) { const by = 31 - ((t * 5 + i * 7) % (h - 2)); R(9 + i * 5, Math.floor(by), 1, 1, P.text); }
	}
	R(8, 9, 1, 17, P.text); R(9, 9, 1, 5, P.softRose);
	R(26, 9, 2, 2, P.border); R(27, 10, 3, 15, P.border); R(26, 24, 2, 2, P.border);
	R(2, 33, 28, 4, P.border); R(2, 33, 28, 1, P.muted);
	R(5, 35, 2, 1, brewing ? P.red : P.green);
	if (brewing) { const dy = Math.floor(t * 10) % 4; R(15, dy, 1, 1, P.sand); }
}

/**
 * Creates the office on `canvas` and starts its frame loop.
 * `hooks.onPot({ level, brewing, time })` runs about every 150 ms so the page can redraw the sidebar pot.
 */
export function createOfficeEngine(canvas, cfg, hooks = {}) {
	const T = cfg.tile, COLS = cfg.cols, ROWS = cfg.rows, W = COLS * T, H = ROWS * T;
	canvas.width = W; canvas.height = H;
	const g = canvas.getContext('2d');
	g.imageSmoothingEnabled = false;
	/* Static floor, wall and fixed props are painted once into this layer. */
	const bgLayer = document.createElement('canvas');
	bgLayer.width = W; bgLayer.height = H;
	const bg = bgLayer.getContext('2d');

	const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
	const B = (x, y, w, h, c) => { bg.fillStyle = c; bg.fillRect(Math.round(x), Math.round(y), w, h); };
	const rnd = (a, b) => a + Math.random() * (b - a);
	const pick = a => a[Math.floor(Math.random() * a.length)];
	const hash = n => { n = Math.sin(n * 127.1) * 43758.5453; return n - Math.floor(n); };

	/* Draw a pixel map: rows of palette letters, '.' is transparent. */
	function sprite(rows, map, x, y, flip) {
		for (let j = 0; j < rows.length; j++) {
			const row = rows[j];
			for (let i = 0; i < row.length; i++) {
				const ch = row[i];
				if (ch === '.' || !map[ch]) continue;
				const px = flip ? x + row.length - 1 - i : x + i;
				R(px, y + j, 1, 1, map[ch]);
			}
		}
	}

	/* ---------- walkable grid ---------- */
	const block = Array.from({ length: ROWS }, (_, y) => Array(COLS).fill(y < 2));
	const mark = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (block[j] && i < COLS) block[j][i] = true; };
	cfg.desks.forEach(d => mark(d.x, d.y, 2, 1));
	const tb = cfg.table, cf = cfg.coffee, wb = cfg.whiteboard;
	mark(tb.x, tb.y, tb.w, tb.h);
	mark(cf.x, cf.y, cf.w, 1);
	cfg.plants.forEach(p => mark(p.x, p.y, 1, 1));
	mark(cfg.rack.x, cfg.rack.y, 1, 2);
	mark(cfg.bench.x, ROWS - 1, cfg.bench.w, 1);

	function path(fx, fy, tx, ty) {
		const key = (x, y) => y * COLS + x, prev = new Map([[key(fx, fy), null]]), q = [[fx, fy]];
		while (q.length) {
			const [x, y] = q.shift();
			if (x === tx && y === ty) break;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx, ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || block[ny][nx]) continue;
				const k = key(nx, ny);
				if (prev.has(k)) continue;
				prev.set(k, [x, y]); q.push([nx, ny]);
			}
		}
		if (!prev.has(key(tx, ty))) return [];
		const res = []; let cur = [tx, ty];
		while (cur) { res.unshift(cur); cur = prev.get(key(cur[0], cur[1])); }
		return res;
	}

	/* Feet anchor: x is tile centre, y sits 4px above the tile bottom. */
	const FX = tx => tx * T + T / 2, FY = ty => ty * T + T - 4;

	/* ---------- spots ---------- */
	const deskSpot = d => ({ tx: d.x, ty: d.y + 1, px: FX(d.x + 1) - 4, py: FY(d.y + 1) - 2, face: 'up', sit: true });
	const spots = {
		/* One row below the wall props so a 48 px tall orchestrator does not cover the board or the pot. */
		whiteboard: { tx: wb.x + 1, ty: 3, px: FX(wb.x + 2), py: FY(3), face: 'up' },
		coffee: { tx: cf.x + 1, ty: cf.y + 2, face: 'up' },
		front: { tx: cfg.front.x, ty: cfg.front.y, face: 'down' },
		rest: { tx: cfg.orchStart.x, ty: cfg.orchStart.y, face: 'down' }
	};
	/* Waiting bench: queued residents stand on the row above the bench. Past the bench width they continue along that row, beside it, so they never stand on a desk seat. */
	const benchSpot = i => ({ tx: cfg.bench.x + (i % (2 * cfg.bench.w)), ty: ROWS - 2, face: 'down' });
	function randomSpot() {
		for (let n = 0; n < 200; n++) {
			const x = Math.floor(rnd(0, COLS)), y = Math.floor(rnd(3, ROWS - 1));
			if (!block[y][x]) return { tx: x, ty: y, face: pick(['down', 'left', 'right']) };
		}
		return spots.rest;
	}

	/* ---------- state ---------- */
	const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
	let reduced = !!(reducedQuery && reducedQuery.matches);
	let time = 0, intent = null, view = null, potShown = 1, potTarget = 1, brewingNow = false;
	let wbLines = 2, wbChecks = 1, wbWriting = false, wbPartial = 1, wbHold = 0;
	let hudT = 0;
	const orch = {
		x: FX(cfg.orchStart.x), y: FY(cfg.orchStart.y), path: [], face: 'down', sit: false, moving: false,
		mode: 'idle', wait: 0.5, bubble: null, step: 0, onArrive: null, target: null
	};

	function goTo(c, s, cb) {
		const fx = Math.floor(c.x / T), fy = Math.max(2, Math.floor((c.y - 2) / T));
		const pts = path(fx, fy, s.tx, s.ty).map(([x, y]) => ({ x: FX(x), y: FY(y) }));
		if (pts.length) pts.shift();
		pts.unshift({ x: FX(fx), y: FY(fy) });
		if (!pts.length || pts[pts.length - 1].x !== FX(s.tx) || pts[pts.length - 1].y !== FY(s.ty)) pts.push({ x: FX(s.tx), y: FY(s.ty) });
		if (s.px != null) pts.push({ x: s.px, y: s.py });
		c.path = pts; c.sit = false; c.target = s; c.onArrive = cb || null;
	}
	function moveChar(c, dt) {
		if (!c.path.length) { c.moving = false; return; }
		const t = c.path[0], dx = t.x - c.x, dy = t.y - c.y, d = Math.hypot(dx, dy), sp = 44 * dt;
		c.moving = true; c.step += dt * 8;
		if (d > 0.5) { if (Math.abs(dx) > Math.abs(dy)) c.face = dx > 0 ? 'right' : 'left'; else c.face = dy > 0 ? 'down' : 'up'; }
		if (d <= sp) {
			c.x = t.x; c.y = t.y; c.path.shift();
			if (!c.path.length) {
				c.moving = false;
				if (c.target) c.face = c.target.face || c.face;
				const cb = c.onArrive; c.onArrive = null; cb && cb();
			}
		} else { c.x += dx / d * sp; c.y += dy / d * sp; }
	}
	/* Reduced motion: a state change still shows, it just does not walk. */
	function placeAt(c, s) {
		c.x = s.px ?? FX(s.tx); c.y = s.py ?? FY(s.ty); c.face = s.face; c.sit = !!s.sit;
		c.path = []; c.onArrive = null; c.moving = false; c.target = s;
	}

	/* ---------- orchestrator behaviour ---------- */
	function arrive(name) {
		if (name === 'whiteboard') { orch.mode = 'plan'; wbWriting = true; wbPartial = 0; }
		else if (name === 'coffee') orch.mode = 'brew';
		else if (name === 'front') orch.mode = 'front';
	}
	function applyIntent(name) {
		intent = name;
		orch.path = []; orch.onArrive = null; orch.target = null; wbWriting = false;
		if (name === 'floor') {
			if (reduced) { placeAt(orch, spots.rest); orch.mode = 'idle'; }
			else { orch.mode = 'idle'; orch.wait = 0.4; }
			return;
		}
		const spot = spots[name];
		if (reduced) { placeAt(orch, spot); arrive(name); return; }
		orch.mode = 'walk';
		goTo(orch, spot, () => arrive(name));
	}
	/* Filler wandering: only while idle on the floor, never under reduced motion. */
	function wander() {
		orch.mode = 'walk';
		goTo(orch, randomSpot(), () => { orch.mode = 'idle'; orch.wait = rnd(1, 2.5); });
	}
	function updateOrch(dt) {
		if (orch.mode === 'plan') {
			wbPartial = Math.min(1, wbPartial + dt * 0.7);
			if (wbPartial >= 1) {
				if (wbLines < 5) { wbLines++; wbChecks = wbLines - 1; wbPartial = 0; }
				else if ((wbHold += dt) > 2) { wbLines = 1; wbChecks = 0; wbPartial = 0; wbHold = 0; }
			}
		} else if (orch.mode === 'idle' && !reduced) {
			orch.wait -= dt;
			if (orch.wait <= 0) wander();
		}
	}

	/* ---------- static background: wall, floor, props (painted once) ---------- */
	function paintStatic() {
		/* Wall band: crown molding, wallpaper with diamond damask, chair rail, wainscot. */
		B(0, 0, W, 2 * T, P.bg);
		B(0, 0, W, 6, P.border); B(0, 0, W, 1, P.deep); B(0, 6, W, 2, shade(P.border));
		B(0, 8, W, 22, P.sel);
		for (let y = 9; y < 30; y += 6) for (let x = (y % 12 ? 4 : 0); x < W; x += 8) B(x, y, 1, 1, goMix(P.sel, P.border, 0.5));
		B(0, 30, W, 2, P.border); B(0, 32, W, 2, P.deep);
		B(0, 34, W, 14, P.panel);
		for (let x = 0; x < W; x += 12) { B(x, 36, 1, 10, P.border); B(x + 1, 36, 1, 10, P.bg); }
		B(0, 46, W, 2, P.border);
		/* Floor: staggered wood planks with grain and seams. */
		for (let y = 2; y < ROWS; y++) {
			const top = y * T;
			for (let p = 0; p < 4; p++) {
				const py = top + p * 6, off = ((y * 7 + p * 5) % 13) * 2;
				for (let x = -off; x < W; x += 52) {
					const base = ((Math.floor(x / 52) + p + y) % 3) ? P.floorA : P.floorB;
					B(Math.max(0, x), py, Math.min(52, W - Math.max(0, x)) - (x < 0 ? -x : 0), 6, base);
					B(Math.max(0, x), py + 5, Math.min(52, W - Math.max(0, x)), 1, P.seam);
					const gx = Math.max(0, x) + 6 + ((p * 11) % 17);
					if (gx < W) B(gx, py + 2, 10, 1, goMix(base, '#2A1523', 0.25));
					if (gx + 22 < W) B(gx + 22, py + 3, 6, 1, goMix(base, '#2A1523', 0.2));
				}
			}
			B(0, top + T - 2, W, 2, P.seam);
		}
		/* Baseboard along the bottom of the wall. */
		B(0, 2 * T - 2, W, 2, P.panel);
		/* Window: night city skyline with a moon. */
		if (cfg.window) {
			const wx = cfg.window.x * T + 3, ww = cfg.window.w * T - 6, wy = 8, wh = 22;
			B(wx - 2, wy - 2, ww + 4, wh + 4, P.border);
			B(wx, wy, ww, wh, P.bg);
			for (let s = 0; s < 6; s++) B(wx, wy + s * 4, ww, 4, goMix(P.bg, P.user, s / 6));
			B(wx + ww - 9, wy + 4, 5, 5, P.sec); B(wx + ww - 8, wy + 3, 3, 1, P.sec); B(wx + ww - 7, wy + 4, 2, 1, P.sec);
			let sx = wx, k = 0;
			while (sx < wx + ww) {
				const bw = 4 + Math.floor(hash(k + 1) * 5), bh = 6 + Math.floor(hash(k + 7) * 12);
				const col = k % 2 ? P.panel : P.sel;
				B(sx, wy + wh - bh, Math.min(bw, wx + ww - sx), bh, col);
				for (let wy2 = wy + wh - bh + 2; wy2 < wy + wh - 2; wy2 += 3) {
					for (let wx2 = sx + 1; wx2 < sx + bw - 1; wx2 += 3) {
						if (hash(wx2 * 3 + wy2 * 5 + k) > 0.55 && wx2 < wx + ww - 1) B(wx2, wy2, 1, 1, P.gold);
					}
				}
				sx += bw; k++;
			}
			B(wx + Math.floor(ww / 2) - 1, wy, 2, wh, P.border);
			B(wx, wy + Math.floor(wh / 2) - 1, ww, 2, P.border);
			B(wx - 2, wy + wh + 2, ww + 4, 2, P.border);
		}
		/* Whiteboard frame (content is drawn live). */
		{
			const x = wb.x * T + 3, w = wb.w * T - 6;
			B(x, 5, w, 26, P.steel); B(x + 2, 7, w - 4, 22, P.text);
			B(x + 2, 7, w - 4, 1, P.sec);
			B(x + 6, 31, w - 12, 2, P.border);
		}
		/* Clock on the wall. */
		if (cfg.clock != null) {
			const cx = cfg.clock * T + 12, cy = 18;
			B(cx - 7, cy - 7, 14, 14, P.border); B(cx - 6, cy - 6, 12, 12, P.text); B(cx - 5, cy - 5, 10, 10, P.panel);
			for (let a = 0; a < 12; a++) { const q = a / 12 * Math.PI * 2; B(cx + Math.round(Math.cos(q) * 4), cy + Math.round(Math.sin(q) * 4), 1, 1, P.gold); }
		}
		/* Bookshelf: three shelves, two rows of colored spines. */
		if (cfg.shelf != null) {
			const x = cfg.shelf * T + 2;
			B(x, 6, 30, 26, P.border); B(x + 2, 8, 26, 22, P.bg);
			[14, 22].forEach(y => B(x + 2, y, 26, 2, P.steel));
			const books = [P.blue, P.red, P.green, P.gold, P.purple, P.sec, P.sand];
			for (let r = 0; r < 3; r++) for (let b = 0; b < 6; b++) {
				const bh = 5 + (b + r) % 3, col = books[(b * 2 + r * 3) % books.length];
				B(x + 3 + b * 4, (r === 0 ? 9 : r === 1 ? 17 : 25) + (6 - bh), 3, bh, col);
			}
		}
		/* Rug with border pattern and corner tassels. */
		if (cfg.rug) {
			const r = cfg.rug, x = r.x * T + 6, y = r.y * T + 6, w = r.w * T - 12, h = r.h * T - 12;
			B(x, y, w, h, P.sel); B(x + 3, y + 3, w - 6, h - 6, goMix(P.sel, P.border, 0.4));
			B(x + 6, y + 6, w - 12, h - 12, P.sel);
			for (let i = 0; i < w - 12; i += 6) B(x + 6 + i, y + 6, 3, 1, P.border);
			for (let i = 0; i < h - 12; i += 6) B(x + 6, y + 6 + i, 1, 3, P.border);
			[[x + 1, y + 1], [x + w - 4, y + 1], [x + 1, y + h - 4], [x + w - 4, y + h - 4]].forEach(([a, b]) => { B(a, b, 3, 3, P.gold); B(a + 1, b + 1, 1, 1, P.text); });
			B(x + w / 2 - 2, y + h / 2 - 2, 4, 4, P.deep);
		}
		/* Door and mat at the bottom edge. */
		if (cfg.door) {
			const d = cfg.door, dx = d.x * T, dy = (ROWS - 1) * T;
			B(dx + 2, dy + 2, d.w * T - 4, T - 2, P.border);
			B(dx + 4, dy + 4, d.w * T - 8, T - 4, P.steel);
			B(dx + 4, dy + 4, d.w * T - 8, 2, C.steelH);
			B(dx + Math.floor(d.w * T / 2) - 1, dy + 4, 2, T - 4, P.border);
			B(dx + d.w * T - 10, dy + 13, 2, 3, P.gold);
			B(dx + 2, dy + T - 6, d.w * T - 4, 4, P.deep);
			B(dx + 4, dy + T - 5, d.w * T - 8, 2, P.violet);
		}
		/* Waiting bench under the door row: queued residents sit or stand here until a desk frees. */
		{
			const x = cfg.bench.x * T, y = (ROWS - 1) * T, w = cfg.bench.w * T;
			B(x + 1, y + 10, w - 2, 4, C.woodH); B(x + 1, y + 10, w - 2, 1, '#FFD9A6');
			B(x + 1, y + 14, w - 2, 2, C.woodS);
			B(x + 2, y + 16, 2, 6, P.border); B(x + w - 4, y + 16, 2, 6, P.border);
		}
		/* Coffee counter: marble top, cabinets, toe kick. */
		{
			const x = cf.x * T, y = cf.y * T, w = cf.w * T;
			B(x, y + 4, w, 4, C.marble); B(x, y + 4, w, 1, '#FFFFFF'); B(x + 4, y + 6, 10, 1, goMix(P.text, P.sec, 0.5));
			B(x, y + 8, w, 16, P.border); B(x, y + 8, w, 1, C.steelH);
			for (let i = 1; i < cf.w; i++) B(x + i * T, y + 9, 1, 14, P.sel);
			for (let i = 0; i < cf.w; i++) { B(x + i * T + 9, y + 15, 6, 1, P.muted); B(x + i * T + 9, y + 14, 6, 1, P.steel); }
			B(x, y + 22, w, 2, P.panel);
			/* Sugar jar and cups on the marble (static). */
			B(x + w - 14, y + 0, 9, 4, P.sec); B(x + w - 14, y + 0, 9, 1, P.text); B(x + w - 13, y - 2, 7, 2, P.border);
			for (let i = 0; i < 3; i++) { B(x + w - 22 + i * 3, y + 1, 3, 3, P.text); B(x + w - 22 + i * 3, y + 1, 3, 1, P.violet); }
		}
		/* Wall-side coffee machine body (LED and drip are live). */
		{
			const x = cf.x * T + 3, y = cf.y * T - 16;
			B(x, y, 15, 14, P.steel); B(x, y, 15, 2, C.steelH); B(x, y + 12, 15, 2, shade(P.steel));
			B(x + 2, y + 3, 11, 5, P.bg); B(x + 2, y + 3, 11, 1, P.border);
			B(x + 5, y + 10, 5, 2, P.border);
		}
	}

	/* ---------- live room parts (drawn each frame) ---------- */
	function drawWindowLights() {
		if (!cfg.window) return;
		const wx = cfg.window.x * T + 3, ww = cfg.window.w * T - 6;
		for (let s = 0; s < 4; s++) {
			const sx = wx + 2 + Math.floor(hash(s + 2) * (ww - 6)), sy = 12 + Math.floor(hash(s + 9) * 10);
			if (!reduced && Math.floor(time * 1.3 + s * 2.7) % 5) R(sx, sy, 1, 1, P.sand);
		}
	}
	function drawClockHands() {
		if (cfg.clock == null) return;
		const cx = cfg.clock * T + 12, cy = 18, a = time * 0.6;
		R(cx + Math.round(Math.cos(a) * 3), cy + Math.round(Math.sin(a) * 3), 1, 1, P.gold);
		R(cx, cy - 3, 1, 3, P.text); R(cx, cy, 1, 1, P.gold);
	}
	function drawWhiteboard() {
		const x = wb.x * T + 5, w = wb.w * T - 10;
		for (let i = 0; i < wbLines; i++) {
			const y = 10 + i * 4;
			if (y > 26) break;
			const full = 12 + Math.floor(hash(i + 3) * (w - 26));
			const len = (i === wbLines - 1 && wbWriting) ? Math.max(1, Math.floor(full * wbPartial)) : full;
			R(x + 3, y, 3, 3, i < wbChecks ? P.green : P.steel);
			if (i < wbChecks) R(x + 4, y + 1, 1, 1, P.bg);
			R(x + 9, y + 1, len, 2, [P.blue, P.red, P.violet, P.blue, P.green][i % 5]);
		}
		R(x + 4, 27, 5, 2, P.red); R(x + 12, 27, 5, 2, P.blue); R(x + 20, 27, 3, 2, P.gold);
	}

	/* Screensaver: a small logo bouncing over the monitor. Static under reduced motion. */
	function drawScreensaver(x, y, w, h, i) {
		const v = reduced ? 0 : time * 0.12 + i * 0.37;
		const px = Math.floor(triangle(v) * (w - 4)), py = Math.floor(triangle(v * 0.71 + 0.3) * (h - 3));
		R(x + px, y + py, 4, 3, [P.purple, P.blue, P.sand, P.green][i % 4]);
		R(x + px + 1, y + py + 1, 2, 1, P.bg);
	}

	function drawDesk(d, i) {
		const x = d.x * T, y = d.y * T;
		/* Desk top and drawer front. */
		R(x + 1, y + 6, 46, 14, C.woodH); R(x + 1, y + 6, 46, 1, '#FFD9A6');
		R(x + 1, y + 19, 46, 3, C.woodS);
		R(x + 2, y + 22, 4, 2, P.border); R(x + 40, y + 22, 4, 2, P.border);
		R(x + 36, y + 9, 8, 3, C.woodS); R(x + 37, y + 10, 6, 1, P.gold);
		/* Monitor: bezel, screen (screensaver when empty, the agent's work while it runs), stand. */
		const mx = x + 14, my = y - 14;
		R(mx, my, 20, 16, P.border); R(mx, my, 20, 1, P.steel);
		R(mx + 1, my + 1, 18, 13, P.bg);
		if (deskWorking[i]) drawWorkingScreen(mx + 1, my + 1, deskWorking[i], i);
		else drawScreensaver(mx + 1, my + 1, 18, 13, i);
		R(mx + 8, my + 16, 4, 3, P.steel); R(mx + 5, my + 19, 10, 2, P.border);
		/* Keyboard, mouse, folder, empty mug. */
		R(x + 9, y + 9, 14, 4, P.steel); R(x + 9, y + 9, 14, 1, P.sec);
		for (let k = 0; k < 4; k++) R(x + 10 + k * 3, y + 10, 2, 1, P.border);
		R(x + 27, y + 9, 4, 5, P.sec); R(x + 27, y + 9, 4, 1, P.text);
		R(x + 3, y + 8, 5, 6, P.muted); R(x + 3, y + 8, 5, 1, C.woodH);
		R(x + 36, y + 9, 6, 6, P.text); R(x + 36, y + 9, 6, 1, P.sec); R(x + 42, y + 11, 2, 2, P.text);
	}

	/* Chairs are drawn CHAIR_LIFT px above their seat spot, so the seat cushion starts 2 px under the desk edge. */
	const CHAIR_LIFT = 12;
	/* Empty chair, sized for the 24 px sitter: the seat cushion and the backrest in front. The caller passes the lifted seat line. */
	function drawChair(px, py, front) {
		if (!front) { R(px - 8, py + 2, 16, 4, P.muted); R(px - 8, py + 2, 16, 1, P.steel); return; }
		R(px - 7, py - 4, 14, 8, P.muted); R(px - 7, py - 4, 14, 1, P.steel); R(px - 7, py + 3, 14, 1, shade(P.muted));
		R(px - 5, py - 2, 10, 5, P.border); R(px - 4, py - 1, 8, 3, P.sel);
		R(px - 2, py + 4, 4, 3, P.border); R(px - 5, py + 7, 2, 1, P.bg); R(px + 3, py + 7, 2, 1, P.bg);
	}

	function drawTable() {
		const x = tb.x * T, y = tb.y * T, w = tb.w * T, h = tb.h * T;
		const topH = h - 12, edge = y + 4 + topH;
		R(x + 2, y + 4, w - 4, topH, C.woodH); R(x + 2, y + 4, w - 4, 1, '#FFD9A6');
		R(x + 2, edge, w - 4, 4, C.woodS); R(x + 2, edge + 4, w - 4, 2, P.border);
		R(x + 4, y + h - 2, 3, 2, P.bg); R(x + w - 7, y + h - 2, 3, 2, P.bg);
		/* Laptop (closed in T2: no sync meeting yet), papers, vase with flowers. */
		const lx = x + 6, ly = y + 5, lh = Math.max(5, topH - 5);
		R(lx, ly, 14, lh, P.steel); R(lx + 1, ly + 1, 12, lh - 2, P.bg);
		R(lx - 2, ly + lh - 1, 18, 2, P.sec);
		R(x + 26, y + 6, 8, 5, P.text); R(x + 26, y + 6, 8, 1, P.sec);
		R(x + 28, y + 8, 4, 1, P.steel);
		const vx = x + w - 16, vy = y + 4;
		R(vx, vy + 8, 8, 8, C.pinkS); R(vx + 1, vy + 8, 6, 1, C.pink); R(vx - 1, vy + 14, 10, 2, P.deep);
		R(vx + 3, vy + 2, 1, 6, C.leafS); R(vx + 1, vy - 1, 3, 3, C.pink); R(vx + 5, vy + 1, 3, 2, P.violet);
		R(vx - 3, vy + 3, 3, 3, C.leaf); R(vx + 7, vy + 4, 3, 3, C.leaf);
	}

	/* The pot level follows the eased fill; the LED is red while brewing. */
	function drawCoffee() {
		const x = cf.x * T, y = cf.y * T, level = potShown;
		const mx = x + 3, my = y - 16;
		R(mx + 2, my + 4, 3, 2, brewingNow ? P.red : P.green);
		if (brewingNow) { const dy = Math.floor(time * 12) % 5; R(mx + 7, my + 14 + dy, 1, 1, C.coffeeH); }
		const px = x + 32, py = y - 12;
		R(px + 1, py - 2, 8, 2, P.border); R(px + 3, py - 3, 4, 1, P.steel);
		R(px, py, 10, 16, P.steel); R(px, py, 10, 1, P.sec);
		R(px + 1, py + 1, 8, 14, P.bg);
		const fh = Math.round(13 * Math.max(0, Math.min(1, level)));
		if (fh > 0) {
			R(px + 1, py + 15 - fh, 8, fh, C.coffee);
			R(px + 1, py + 15 - fh, 8, 1, C.coffeeH);
			if (fh > 4) R(px + 2, py + 15 - fh + 2, 1, fh - 3, goMix(C.coffee, '#F6EFF3', 0.3));
		}
		R(px + 10, py + 4, 3, 7, P.steel); R(px + 11, py + 6, 1, 3, P.bg);
		R(px + 4, py + 16, 2, 1, P.border);
	}

	function drawPlant(p) {
		const x = p.x * T, y = p.y * T;
		/* Big leafy plant in a pink pot. */
		R(x + 5, y + 14, 14, 9, C.pinkS); R(x + 5, y + 14, 14, 1, C.pink); R(x + 4, y + 13, 16, 2, C.pink);
		R(x + 6, y + 21, 12, 1, P.border); R(x + 8, y + 13, 8, 1, P.border);
		const leaves = [[1, 4, 6, 7], [16, 5, 6, 7], [4, -1, 6, 8], [13, -1, 6, 8], [8, -4, 8, 9], [9, 0, 6, 6]];
		leaves.forEach(([lx, ly, lw, lh], i) => {
			R(x + lx, y + ly, lw, lh, i % 2 ? C.leaf : C.leafS);
			R(x + lx + 1, y + ly + 1, lw - 3, 1, C.leafH);
			R(x + lx + Math.floor(lw / 2), y + ly + 2, 1, lh - 3, C.leafS);
		});
	}

	function drawRack() {
		const x = cfg.rack.x * T, y = cfg.rack.y * T;
		R(x + 2, y - 6, 20, 46, P.border); R(x + 2, y - 6, 20, 1, P.steel);
		for (let i = 0; i < 7; i++) {
			const yy = y - 3 + i * 6;
			R(x + 4, yy, 16, 4, P.sel); R(x + 4, yy, 16, 1, P.border);
			const on = reduced ? i % 2 === 0 : hash(i + Math.floor(time * 4) * 7) > 0.35;
			R(x + 6, yy + 2, 1, 1, on ? P.green : P.bg); R(x + 9, yy + 2, 1, 1, i % 2 ? P.blue : P.gold);
			R(x + 12, yy + 1, 6, 2, P.bg);
		}
	}

	/* ---------- figures: one body template for the orchestrator and every resident ---------- */
	/* Sprite box is 24x36 with the feet on the last row (oy + 35). Rows: head 0-13, neck 14, torso 15-25, legs 26-33, shoes 34-35. */
	/* `f` = { color, walk, sw, sit }. Seated figures show thighs instead of legs; `sw` moves the hands while typing or walking. */
	function drawFigure(ox, oy, f) {
		const s = f.color, sh = shade(s), hl = hi(s);
		/* Neck: the head map covers its top row. */
		R(ox + 9, oy + 14, 6, 1, SKIN_SH);
		/* Torso with ink outline, shaded flank and a chest highlight. */
		R(ox + 5, oy + 15, 1, 11, INK); R(ox + 18, oy + 15, 1, 11, INK);
		R(ox + 6, oy + 15, 12, 11, s); R(ox + 6, oy + 15, 1, 11, sh); R(ox + 17, oy + 15, 1, 11, sh);
		R(ox + 8, oy + 15, 2, 5, hl);
		/* Arms: sleeves to row 23, hands below with a knuckle shadow. Seated hands rest higher, on the keyboard. */
		R(ox + 2, oy + 15, 1, 9, INK); R(ox + 21, oy + 15, 1, 9, INK);
		R(ox + 3, oy + 15, 2, 9, s); R(ox + 19, oy + 15, 2, 9, s);
		R(ox + 3, oy + 15, 1, 9, sh); R(ox + 20, oy + 15, 1, 9, sh);
		const base = f.sit ? 22 : 24, sw = f.sw || 0;
		R(ox + 3, oy + base + sw, 2, 2, SKIN); R(ox + 19, oy + base - sw, 2, 2, SKIN);
		R(ox + 3, oy + base + sw + 1, 2, 1, SKIN_SH); R(ox + 19, oy + base - sw + 1, 2, 1, SKIN_SH);
		if (f.sit) { R(ox + 6, oy + 26, 12, 4, LEG); R(ox + 6, oy + 26, 12, 1, LEG_H); return; }
		/* Legs and shoes; a stepping leg lifts one pixel. */
		const lOff = f.walk === 1 ? 1 : 0, rOff = f.walk === 3 ? 1 : 0;
		R(ox + 7, oy + 26, 4, 8 - lOff, LEG); R(ox + 13, oy + 26, 4, 8 - rOff, LEG);
		R(ox + 7, oy + 26, 1, 8 - lOff, LEG_H); R(ox + 13, oy + 26, 1, 8 - rOff, LEG_H);
		R(ox + 6, oy + 34 - lOff, 5, 2, INK); R(ox + 13, oy + 34 - rOff, 5, 2, INK);
		R(ox + 7, oy + 34 - lOff, 2, 1, P.steel); R(ox + 14, oy + 34 - rOff, 2, 1, P.steel);
	}

	/* ---------- orchestrator sprite: top hat with a fuchsia rose, fuchsia handlebar mustache, black monocle, champagne suit ---------- */

	function drawOrchHead(ox, oy, fam, flip) {
		const fx = (x, w) => (flip ? ox + 23 - x - (w || 1) + 1 : ox + x);
		const hX = (x, w, y, h, col) => R(fx(x, w), oy + y, w, h, col);
		/* Top hat: dark crown with a gold band, a brim wider than the head, and a fuchsia rose on the crown. */
		hX(6, 12, -11, 7, P.bg); hX(7, 10, -11, 1, P.border); hX(15, 3, -9, 5, shade(P.bg));
		hX(6, 12, -4, 1, P.gold); hX(6, 12, -3, 1, shade(P.gold));
		hX(3, 18, -2, 1, P.border); hX(3, 18, -1, 1, P.bg);
		hX(11, 1, -7, 2, C.leafS); hX(10, 1, -6, 1, C.leafS);
		hX(13, 3, -11, 1, STACHE); hX(12, 5, -10, 3, STACHE); hX(13, 3, -7, 1, STACHE);
		hX(13, 2, -9, 1, STACHE_S); hX(15, 1, -10, 2, STACHE_S); hX(14, 1, -8, 1, STACHE_S); hX(13, 1, -11, 1, P.violet);
		if (fam === 'up') {
			/* Back view: only the handlebar tips show past the head. */
			hX(0, 2, 9, 2, STACHE); hX(22, 2, 9, 2, STACHE); hX(0, 1, 8, 1, STACHE_S); hX(23, 1, 8, 1, STACHE_S);
			return;
		}
		if (fam === 'side') {
			/* Chain first, so the mustache covers its top. Monocle ring with a glinting lens on the visible eye. */
			hX(8, 1, 10, 1, MONOCLE); hX(8, 1, 11, 1, MONOCLE_H); hX(9, 1, 12, 1, MONOCLE);
			hX(6, 2, 6, 1, MONOCLE); hX(5, 1, 7, 2, MONOCLE); hX(8, 1, 7, 2, MONOCLE); hX(6, 2, 9, 1, MONOCLE);
			hX(6, 2, 7, 2, P.sky); hX(6, 1, 7, 1, P.text);
			/* Handlebar tips poke out in front of the face. */
			hX(3, 5, 10, 2, STACHE); hX(2, 2, 9, 1, STACHE); hX(2, 1, 8, 1, STACHE_S); hX(3, 5, 11, 1, STACHE_S);
		} else {
			/* Chain hangs from the monocle; the mustache covers its upper links. */
			hX(19, 1, 10, 2, MONOCLE); hX(19, 1, 12, 1, MONOCLE_H); hX(19, 1, 13, 1, MONOCLE);
			/* Monocle ring with a glinting lens over the right eye. */
			hX(17, 2, 6, 1, MONOCLE); hX(16, 1, 7, 2, MONOCLE); hX(19, 1, 7, 2, MONOCLE); hX(17, 2, 9, 1, MONOCLE);
			hX(17, 2, 7, 2, P.sky); hX(17, 1, 7, 1, P.text);
			/* Handlebar mustache: wider than the face, curled tips, shaded underside. */
			hX(2, 20, 10, 2, STACHE); hX(3, 18, 11, 1, STACHE_S);
			hX(0, 2, 9, 2, STACHE); hX(22, 2, 9, 2, STACHE); hX(0, 1, 9, 1, STACHE_S); hX(23, 1, 9, 1, STACHE_S);
		}
	}

	/* Champagne vest with a white shirt front, gold buttons and a purple bow tie. */
	function drawOrchTie(ox, oy) {
		R(ox + 9, oy + 15, 6, 1, P.purple); R(ox + 10, oy + 16, 4, 1, P.deep);
		R(ox + 10, oy + 17, 4, 8, P.text);
		R(ox + 11, oy + 20, 2, 1, P.gold); R(ox + 11, oy + 23, 2, 1, P.gold);
	}

	function headFor(c) {
		if (c.face === 'up') return { rows: HEAD_UP, flip: false, fam: 'up' };
		if (c.face === 'left') return { rows: HEAD_SIDE, flip: false, fam: 'side' };
		if (c.face === 'right') return { rows: HEAD_SIDE, flip: true, fam: 'side' };
		return { rows: HEAD_DOWN, flip: false, fam: 'down' };
	}

	function drawOrchestrator(c) {
		const fx = Math.round(c.x), fy = Math.round(c.y);
		const walk = c.moving ? Math.floor(c.step) % 4 : 0, bob = c.moving && walk % 2 ? 1 : 0;
		const ox = fx - 12, oy = fy - 35 - bob;
		const sw = c.moving ? (walk === 1 ? -1 : walk === 3 ? 1 : 0) : 0;
		g.globalAlpha = 0.35; R(fx - 9, fy - 1, 18, 2, INK); g.globalAlpha = 1;
		const { rows, flip, fam } = headFor(c);
		drawFigure(ox, oy, { color: ORCH_COLOR, walk, sw, sit: false });
		const map = { K: INK, H: ORCH_HAIR, h: shade(ORCH_HAIR), l: hi(ORCH_HAIR), S: SKIN, s: SKIN_SH, E: INK, W: P.text, C: P.softRose, M: P.deep };
		sprite(rows, map, ox, oy, flip);
		const blink = !reduced && Math.floor(time * 10) % 37 === 0;
		if (blink && fam === 'down') { R(ox + 5, oy + 7, 2, 2, SKIN); R(ox + 5, oy + 8, 2, 1, INK); }
		drawOrchHead(ox, oy, fam, flip);
		drawOrchTie(ox, oy);
	}

	/* Speech bubble, 18x14, with a 10x8 icon. Drawn in the final pass. */
	function drawBubble(x, y, icon) {
		R(x, y, 18, 14, INK); R(x + 1, y + 1, 16, 11, P.text); R(x + 1, y + 1, 16, 1, P.sec);
		R(x + 7, y + 12, 3, 2, INK); R(x + 8, y + 14, 1, 1, INK); R(x + 8, y + 12, 1, 1, P.text);
		const ix = x + 4, iy = y + 3;
		if (icon === 'dots') { const n = 1 + Math.floor(time * 3) % 3; for (let i = 0; i < n; i++) R(ix + 1 + i * 3, iy + 2, 2, 2, P.steel); }
		else if (icon === 'cup') { R(ix, iy + 2, 6, 4, P.sand); R(ix, iy + 2, 6, 1, P.gold); R(ix + 6, iy + 3, 2, 2, P.sand); R(ix + 1, iy, 1, 2, P.steel); R(ix + 3, iy, 1, 2, P.steel); }
		else if (icon === 'idea') { R(ix + 2, iy, 4, 4, P.gold); R(ix + 3, iy + 4, 2, 2, P.steel); }
		else if (icon === 'wrench') { R(ix + 4, iy, 3, 2, P.steel); R(ix + 5, iy, 1, 1, P.bg); R(ix + 3, iy + 2, 2, 2, P.steel); R(ix + 2, iy + 4, 2, 2, P.steel); R(ix + 1, iy + 5, 2, 1, P.sand); }
		else if (icon === 'question') { R(ix + 1, iy, 4, 1, P.purple); R(ix + 4, iy + 1, 1, 2, P.purple); R(ix + 2, iy + 3, 2, 1, P.purple); R(ix + 2, iy + 5, 1, 1, P.purple); }
		else if (icon === 'check') { R(ix + 1, iy + 4, 2, 2, P.green); R(ix + 3, iy + 6, 2, 2, P.green); R(ix + 5, iy + 4, 2, 2, P.green); R(ix + 7, iy + 2, 2, 2, P.green); }
		else if (icon === 'bang') { R(ix + 4, iy, 2, 5, P.red); R(ix + 4, iy + 7, 2, 2, P.red); }
	}

	function drawOrchBubble() {
		if (!orch.bubble) return;
		drawBubble(Math.round(orch.x) - 9, Math.round(orch.y) - 35 - 27, orch.bubble.icon);
	}

	/* ---------- residents: one sprite per resident subagent (S7, T3) ---------- */
	/* Sprites follow the approved design (design/agent-office/01-overworld-hq.html: drawBody, drawKit), redrawn at 24x36 (T9). */
	const LEAVE_DELAY = 1.6;
	const residents = new Map();
	let deskWorking = cfg.desks.map(() => null);
	/* Explore: powder blue, safari hat, binoculars. Worker: mint or sky, hard hat, tool belt. Verify: pink, lab coat, glasses, clipboard. */
	const lookFor = a => {
		if (a.role === 'explore') return { color: P.blue, hair: P.gold, kit: 'explore' };
		if (a.role === 'verify') return { color: P.purple, hair: P.border, kit: 'verify' };
		return strHash(a.id) % 2 === 0 ? { color: P.green, hair: P.purple, kit: 'worker' } : { color: P.sky, hair: P.steel, kit: 'worker' };
	};
	const seatSpot = seat => (seat.zone === 'desk' ? deskSpot(cfg.desks[seat.index]) : benchSpot(seat.index));
	const sameSeat = (a, b) => !!a && !!b && a.zone === b.zone && a.index === b.index;
	/* Reduced motion: an agent snaps to its seat. Otherwise it walks there. */
	function walkTo(c, s) {
		if (reduced) return placeAt(c, s);
		goTo(c, s, () => { c.sit = !!s.sit; });
	}
	function bubbleFor(a) {
		if (a.status === 'waiting') return { icon: 'question', t: Infinity };
		if (a.seat.zone === 'bench' && a.status === 'queued') return { icon: 'dots', t: Infinity };
		return null;
	}
	function startLeaving(c, status) {
		c.leaving = true; c.exiting = false; c.typing = false;
		c.leaveAt = time + LEAVE_DELAY;
		c.bubble = { icon: status === 'completed' ? 'check' : 'bang', t: Infinity };
	}
	function startExit(c) {
		c.exiting = true; c.bubble = null; c.sit = false;
		const exit = { tx: cfg.door.x, ty: ROWS - 1, face: 'down' };
		if (reduced) { placeAt(c, exit); depart(c); return; }
		goTo(c, exit, () => depart(c));
	}
	function depart(c) {
		residents.delete(c.id);
		hooks.onDeparted && hooks.onDeparted(c.id);
	}
	/* Mirrors the scene: new agents walk in (restored ones appear at once), seat changes walk, finished agents leave. */
	function syncResidents(agents) {
		const seen = new Set();
		for (const a of agents) {
			seen.add(a.id);
			let c = residents.get(a.id);
			if (!c) {
				c = { id: a.id, seat: null, x: 0, y: 0, path: [], face: 'down', sit: false, moving: false, step: 0, target: null, onArrive: null, bubble: null, typing: false, leaving: false, exiting: false, leaveAt: 0, ...lookFor(a) };
				residents.set(a.id, c);
				if (a.instant || reduced) placeAt(c, seatSpot(a.seat));
				else { c.x = FX(cfg.door.x); c.y = FY(ROWS - 1); walkTo(c, seatSpot(a.seat)); }
			} else if (!c.leaving && !sameSeat(c.seat, a.seat)) {
				walkTo(c, seatSpot(a.seat));
			}
			c.seat = a.seat;
			Object.assign(c, lookFor(a));
			if (a.leaving && !c.leaving) startLeaving(c, a.status);
			if (!c.leaving) c.bubble = bubbleFor(a);
			c.typing = !c.leaving && a.seat.zone === 'desk' && a.status === 'running';
		}
		// A finished agent walks out on its own and reports `departed`; anything else the scene dropped leaves at once.
		for (const [id, c] of residents) if (!seen.has(id) && !c.leaving) residents.delete(id);
	}
	function updateResidents(dt) {
		for (const c of [...residents.values()]) {
			moveChar(c, dt);
			if (c.leaving && !c.exiting && time >= c.leaveAt) startExit(c);
		}
	}
	/* Role props over the head and body: hat, gear, glasses, coat. Headwear gets a 1 px ink edge so it reads on the desk tops. */
	function drawKit(c, ox, oy, fam, flip) {
		const fx = (x, w) => (flip ? ox + 23 - x - (w || 1) + 1 : ox + x);
		const hX = (x, w, y, h, col) => R(fx(x, w), oy + y, w, h, col);
		const edge = (x, w, y, h) => R(fx(x, w) - 1, oy + y - 1, w + 2, h + 2, INK);
		if (c.kit === 'explore') {
			/* Safari hat: sand crown with a gold band and a wide brim. Binoculars hang from a strap on the chest. */
			edge(6, 12, -8, 5); edge(2, 20, -3, 2);
			hX(6, 12, -8, 4, P.sand); hX(6, 12, -8, 1, hi(P.sand)); hX(15, 3, -7, 3, shade(P.sand));
			hX(6, 12, -4, 1, P.gold);
			hX(2, 20, -3, 2, P.sand); hX(2, 20, -3, 1, hi(P.sand)); hX(2, 20, -2, 1, shade(P.sand));
			if (fam !== 'side') {
				hX(11, 2, 17, 1, P.sec);
				hX(8, 3, 18, 3, P.steel); hX(13, 3, 18, 3, P.steel);
				hX(9, 1, 19, 1, P.bg); hX(14, 1, 19, 1, P.bg);
			}
		}
		if (c.kit === 'worker') {
			/* Hard hat: gold dome with a shine and a brim. Tool belt with a buckle and a hanging wrench. */
			edge(5, 14, -6, 4); edge(2, 20, -2, 2);
			hX(5, 14, -6, 4, P.gold); hX(7, 4, -6, 1, hi(P.gold)); hX(15, 4, -5, 3, shade(P.gold));
			hX(2, 20, -2, 2, P.gold); hX(2, 20, -2, 1, hi(P.gold)); hX(2, 20, -1, 1, shade(P.gold));
			hX(6, 12, 25, 1, P.border); hX(11, 2, 25, 1, P.gold);
			hX(15, 2, 25, 1, P.steel); hX(16, 1, 26, 2, P.steel);
		}
		if (c.kit === 'verify') {
			/* Lab coat over the torso and sleeves, lapels, glasses with glinting lenses, clipboard in the right hand. */
			hX(6, 12, 15, 11, P.text); hX(6, 1, 15, 11, P.sec); hX(17, 1, 15, 11, P.sec);
			hX(9, 1, 15, 4, P.sec); hX(14, 1, 15, 4, P.sec);
			hX(3, 2, 15, 9, P.text); hX(19, 2, 15, 9, P.text);
			if (fam !== 'side') {
				hX(4, 4, 6, 4, P.border); hX(5, 2, 7, 2, P.sky);
				hX(16, 4, 6, 4, P.border); hX(17, 2, 7, 2, P.sky);
				hX(8, 8, 7, 1, P.border);
			} else {
				hX(5, 4, 6, 4, P.border); hX(6, 2, 7, 2, P.sky);
			}
			hX(20, 4, 19, 6, P.sand); hX(21, 2, 20, 4, P.text);
			hX(21, 1, 21, 1, P.green); hX(21, 1, 23, 1, P.blue); hX(20, 4, 19, 1, P.steel);
		}
	}
	function drawResident(c) {
		const fx = Math.round(c.x), fy = Math.round(c.y);
		const walk = c.moving ? Math.floor(c.step) % 4 : 0, bob = c.moving && walk % 2 ? 1 : 0;
		const ox = fx - 12, oy = fy - 35 - bob;
		const typingSwing = reduced ? 0 : (Math.floor(time * 6) % 2 ? 1 : -1);
		const sw = c.typing && c.sit ? typingSwing : c.moving ? (walk === 1 ? -1 : walk === 3 ? 1 : 0) : 0;
		g.globalAlpha = 0.35; R(fx - 9, fy - 1, 18, 2, INK); g.globalAlpha = 1;
		const { rows, flip, fam } = headFor(c);
		drawFigure(ox, oy, { color: c.color, walk, sw, sit: c.sit });
		sprite(rows, { K: INK, H: c.hair, h: shade(c.hair), l: hi(c.hair), S: SKIN, s: SKIN_SH, E: INK, W: P.text, C: P.softRose, M: P.deep }, ox, oy, flip);
		drawKit(c, ox, oy, fam, flip);
	}
	/* Desk monitor while its agent runs: a small code screen in the agent's colour, flickering like typing. */
	function drawWorkingScreen(x, y, color, i) {
		R(x, y, 18, 13, P.bg);
		const tick = reduced ? 0 : Math.floor(time * 3);
		for (let k = 0; k < 5; k++) R(x + 2, y + 2 + k * 2, 4 + Math.floor(hash(i * 13 + k * 7 + tick + k) * 10), 1, k === 0 ? color : P.steel);
		if (tick % 2 === 0) R(x + 2, y + 12, 3, 1, color);
	}

	/* ---------- scene input and frame update ---------- */
	function setScene(next) {
		view = next;
		if (next.intent !== intent) applyIntent(next.intent);
		orch.bubble = next.bubble ? { icon: next.bubble, t: Infinity } : null;
		potTarget = next.potLevel;
		syncResidents(next.agents || []);
		deskWorking = cfg.desks.map((_, i) => {
			const owner = (next.agents || []).find(a => a.seat && a.seat.zone === 'desk' && a.seat.index === i && a.status === 'running' && !a.leaving);
			return owner ? lookFor(owner).color : null;
		});
	}

	function update(dt) {
		moveChar(orch, dt);
		if (orch.bubble) { orch.bubble.t -= dt; if (orch.bubble.t <= 0) orch.bubble = null; }
		updateOrch(dt);
		updateResidents(dt);
		potShown += (potTarget - potShown) * Math.min(1, dt * 1.2);
		brewingNow = !!(view && view.brewing) && orch.mode === 'brew';
	}

	function draw() {
		g.drawImage(bgLayer, 0, 0);
		drawWindowLights();
		drawClockHands();
		drawWhiteboard();
		const list = [];
		cfg.desks.forEach((d, i) => {
			const s = deskSpot(d), chairY = s.py - CHAIR_LIFT;
			list.push({ k: (d.y + 1) * T - 1, f: () => drawDesk(d, i) });
			/* Both chair halves sort before the resident on the seat, so a seated figure covers its chair. */
			list.push({ k: s.py - 0.6, f: () => drawChair(s.px, chairY, false) });
			list.push({ k: s.py - 0.5, f: () => drawChair(s.px, chairY, true) });
		});
		list.push({ k: (tb.y + tb.h) * T - 1, f: drawTable });
		list.push({ k: (cf.y + 1) * T - 1, f: drawCoffee });
		cfg.plants.forEach(p => list.push({ k: (p.y + 1) * T - 1, f: () => drawPlant(p) }));
		list.push({ k: (cfg.rack.y + 2) * T - 1, f: drawRack });
		list.push({ k: orch.y, f: () => drawOrchestrator(orch) });
		residents.forEach(c => list.push({ k: c.y, f: () => drawResident(c) }));
		list.sort((p, q) => p.k - q.k).forEach(o => o.f());
		drawOrchBubble();
		/* A seated resident's bubble rises above its desk monitor. A standing one (bench queue) sits just over its head, clear of the desk chairs. */
		residents.forEach(c => { if (c.bubble) drawBubble(Math.round(c.x) - 9, Math.round(c.y) - 35 - (c.sit ? 36 : 14), c.bubble.icon); });
	}

	let last = performance.now();
	let stopped = false;
	function frame(now) {
		if (stopped) return;
		/* The first rAF stamp can precede `last` (taken at construction); a negative dt made a zero-length walk divide 0/0 into NaN. */
		const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
		last = now;
		time += dt;
		update(dt);
		draw();
		hudT -= dt;
		if (hudT <= 0) {
			hudT = 0.15;
			hooks.onPot && hooks.onPot({ level: potShown, brewing: brewingNow, time });
		}
		requestAnimationFrame(frame);
	}

	const onMotionChange = e => { reduced = e.matches; };
	if (reducedQuery && reducedQuery.addEventListener) reducedQuery.addEventListener('change', onMotionChange);

	paintStatic();
	/* Start from the rest spot until the first scene arrives; the page calls setScene straight after. */
	applyIntent('floor');
	requestAnimationFrame(frame);

	return {
		setScene,
		destroy() {
			stopped = true;
			if (reducedQuery && reducedQuery.removeEventListener) reducedQuery.removeEventListener('change', onMotionChange);
		}
	};
}
