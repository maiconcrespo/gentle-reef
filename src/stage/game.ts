import type { OfficeSnapshot } from "../adapter/hub.ts";
import { HQ_HEIGHT, HQ_WIDTH } from "../../web/hq-scene.js";
import { wrap } from "./chat.ts";

/** Game mode (T3): the Gentle HQ layout drawn over Pi's chat. Row 0 is the HUD; below it, the room and a text column. */
export interface GameLayout {
	readonly hudRows: number;
	readonly bodyRows: number;
	/** Cells the room image takes, left. */
	readonly roomCols: number;
	/** Blank cells between the room and the framed text column. */
	readonly gap: number;
	/** Cells of the text column, right: Doing now, party and chat. */
	readonly sideCols: number;
}

export interface CellSize {
	readonly widthPx: number;
	readonly heightPx: number;
}

/* No HUD row: since T4f the project, branch, context and brand are signs in the scene. */
const HUD_ROWS = 0;
const GAP = 3;
const MIN_SIDE_COLS = 32;
const MIN_COLS = 60;
const MIN_ROWS = 8;

/**
 * Splits `cols` x `rows` cells: the room as wide as its height allows (it keeps the 720 x 408 shape), the rest for text,
 * which never gets fewer than 32 columns. Null when the terminal is too small to be worth it: plain Pi stays.
 */
export function gameLayout(cols: number, rows: number, cell: CellSize): GameLayout | null {
	if (cols < MIN_COLS || rows < MIN_ROWS) return null;
	const bodyRows = rows - HUD_ROWS;
	const byHeight = Math.floor((bodyRows * cell.heightPx * HQ_WIDTH) / HQ_HEIGHT / cell.widthPx);
	const roomCols = Math.max(1, Math.min(byHeight, cols - MIN_SIDE_COLS - GAP));
	return { hudRows: HUD_ROWS, bodyRows, roomCols, gap: GAP, sideCols: cols - roomCols - GAP };
}

/* SGR colours and APC sequences (Kitty images, pi-tui's cursor markers) take no cells. */
const ESCAPES = /\x1b\[[0-9;]*m|\x1b_[^\x1b]*\x1b\\/g;

/** Visible cells of a line, for one-cell characters (the game text is ASCII and box drawing). */
export function plainWidth(line: string): number {
	return [...line.replace(ESCAPES, "")].length;
}

/** Pads with spaces, or cuts, to exactly `width` visible cells; escapes are kept and never cut in half. */
export function fit(line: string, width: number): string {
	let out = "", used = 0;
	for (let at = 0; at < line.length; ) {
		ESCAPES.lastIndex = at;
		const escape = ESCAPES.exec(line);
		if (escape && escape.index === at) {
			out += escape[0];
			at += escape[0].length;
			continue;
		}
		const char = String.fromCodePoint(line.codePointAt(at)!);
		if (used < width) { out += char; used += 1; }
		at += char.length;
	}
	return out + " ".repeat(Math.max(0, width - used));
}

/**
 * The overlay's lines: the HUD across the top, then per body row the room line (the first carries the Kitty image, the
 * rest are the rows it covers), the gap, and the text column cut to its width.
 */
/** Text drawn over the room image at a cell position (a sign): panel cells with their own background. */
export interface Sign {
	readonly row: number;
	readonly col: number;
	readonly text: string;
}

/* The room rows are the image escape (row 0) and blank cells: signs go into those blank cells, the escape stays first. */
function withSigns(room: string, signs: readonly Sign[], width: number): string {
	if (signs.length === 0) return fit(room, width);
	const escapes = (room.match(ESCAPES) ?? []).join("");
	let out = "", at = 0;
	for (const sign of [...signs].sort((a, b) => a.col - b.col)) {
		if (sign.col < at) continue;
		out += " ".repeat(sign.col - at) + sign.text;
		at = sign.col + plainWidth(sign.text);
	}
	return escapes + fit(out, width);
}

export function composeGame(layout: GameLayout, content: { hud: string; room: readonly string[]; side: readonly string[]; dialog?: readonly string[]; signs?: readonly Sign[] }): string[] {
	const width = layout.roomCols + layout.gap + layout.sideCols;
	const lines = layout.hudRows > 0 ? [fit(content.hud, width)] : [];
	const signs = content.signs ?? [];
	const dialog = content.dialog ?? [];
	// The dialog sits on the room's bottom rows, 2 cells in; never on row 0, which carries the image.
	const dialogStart = Math.max(1, layout.bodyRows - dialog.length);
	for (let row = 0; row < layout.bodyRows; row++) {
		const over = row >= dialogStart ? dialog[row - dialogStart] : undefined;
		const room = over === undefined ? withSigns(content.room[row] ?? "", signs.filter(sign => sign.row === row), layout.roomCols) : "  " + fit(over, layout.roomCols - 2);
		lines.push(room + " ".repeat(layout.gap) + fit(content.side[row] ?? "", layout.sideCols));
	}
	return lines;
}

/* Kitty z-index below cells with a background colour: panel cells drawn over the room hide it, plain cells show it. */
const BELOW_BACKGROUNDS = -1_073_741_825;

/**
 * The room image sent once (T10). pi-tui's sequence transmits and shows the image in one go, so the PNG's base64 (about
 * 150 KB) sat in the overlay's first line, which Pi measures and composites on every keystroke. Split it: `transmit`
 * drops the old placements and sends the data (`a=t`, written to the terminal only when the PNG changes); `place` is the
 * line's tiny placement (`a=p`). A new `placement` number changes the line, so Pi redraws it after a transmission.
 */
export function splitKitty(sequence: string, options: { imageId: number; columns: number; rows: number; z: number; placement: number }): { transmit: string; place: string } {
	const { imageId, columns, rows, z, placement } = options;
	const transmit = `\x1b_Ga=d,d=i,i=${imageId},q=2\x1b\\` + sequence.replace("\x1b_Ga=T,", "\x1b_Ga=t,");
	const place = `\x1b_Ga=p,i=${imageId},p=${placement},c=${columns},r=${rows},C=1,q=2,z=${z}\x1b\\`;
	return { transmit, place };
}

/** The z-index that puts the room below cell backgrounds (see belowBackgrounds). */
export const ROOM_Z = BELOW_BACKGROUNDS;

/** Puts a pi-tui Kitty sequence below cell backgrounds, so the dialog's panel can be drawn over the room. */
export function belowBackgrounds(sequence: string): string {
	return sequence.replace("\x1b_Ga=T,", `\x1b_Ga=T,z=${BELOW_BACKGROUNDS},`);
}

/* Truecolor SGR from the Gentleman-Cute tokens (design/system.md). */
const sgr = (hex: string) => `\x1b[38;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`;
const RESET = "\x1b[0m";
const GOLD = sgr("#E0C27A"), PINK = sgr("#F095C8"), MUTED = sgr("#A78E9B"), SAND = sgr("#F2B86D");

const IN_FLIGHT: ReadonlySet<string> = new Set(["queued", "running", "waiting"]);
const ORCHESTRATOR_TEXT: Record<string, string> = { idle: "resting", thinking: "at the whiteboard", tool: "at the whiteboard", "waiting-user": "waiting for you" };

const bg = (hex: string) => `\x1b[48;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`;
const INK = sgr("#060407"), BORDER = sgr("#C96AA2"), TEXT = sgr("#F6EFF3");
const PANEL_BG = bg("#100A0F"), PINK_BG = bg("#F095C8"), BOLD = "\x1b[1m";

/** A framed panel like the design's boxes: a gold title in the top border, the body padded inside, panel background, an optional footer in the bottom border. */
export function frame(title: string, body: readonly string[], width: number, height: number, footer?: string): string[] {
	const inner = Math.max(1, width - 4);
	const paint = (line: string) => PANEL_BG + line.replaceAll(RESET, RESET + PANEL_BG) + RESET;
	const top = `${BORDER}╔═ ${GOLD}${BOLD}${title}${RESET}${BORDER} ${"═".repeat(Math.max(0, width - 5 - [...title].length))}╗${RESET}`;
	const rows = Array.from({ length: Math.max(0, height - 2) }, (_, i) => `${BORDER}║${RESET} ${fit(body[i] ?? "", inner)} ${BORDER}║${RESET}`);
	const bottom = footer
		? `${BORDER}╚═${RESET}${fit(` ${MUTED}${footer}${RESET} ${BORDER}${"═".repeat(width)}`, width - 3)}${BORDER}╝${RESET}`
		: `${BORDER}╚${"═".repeat(Math.max(0, width - 2))}╝${RESET}`;
	return [top, ...rows, bottom].map(paint);
}

/** Extra lines in the text column: the todo task in progress (T4b). */
export interface SideExtras {
	readonly doing?: { readonly title: string; readonly done: number; readonly total: number } | null;
	/** The newest notice from any extension (src/stage/notice.ts), while it is fresh. */
	readonly notice?: { readonly text: string; readonly level: "info" | "warning" | "error" } | null;
	/** False hides the CHAT box (alt+c, T9): the dialog over the room already shows the reply. */
	readonly chatShown?: boolean;
}

const NOTICE_TITLE = { info: "NOTICE", warning: "WARNING", error: "ERROR" } as const;
const NOTICE_LINES = 3;

/** The text column: a PARTY box (orchestrator, Doing now, then each agent in flight) and a CHAT box with as much chat as fits, newest last. */
export function gameSide(snapshot: OfficeSnapshot, chat: readonly string[], rows: number, width: number, extras: SideExtras = {}): string[] {
	const row = (name: string, text: string) => `${PINK}▶${RESET} ${TEXT}${name.padEnd(14)}${RESET}${MUTED}${text}${RESET}`;
	const party = [
		row("orchestrator", ORCHESTRATOR_TEXT[snapshot.orchestrator.state] ?? snapshot.orchestrator.state),
		...(extras.doing ? [`${SAND}◐${RESET} ${TEXT}${`doing ${extras.doing.done}/${extras.doing.total}`.padEnd(14)}${RESET}${MUTED}${extras.doing.title}${RESET}`] : []),
		...snapshot.agents.filter(agent => IN_FLIGHT.has(agent.status)).map(agent => row(agent.role, agent.status)),
	];
	const partyBox = frame("PARTY", party, width, party.length + 2);
	// A notice gets its own box under PARTY, only while CHAT still keeps its frame and one line.
	const noticeBody = extras.notice ? wrap(extras.notice.text, width - 4).slice(0, NOTICE_LINES).map(line => `${extras.notice!.level === "info" ? TEXT : SAND}${line}${RESET}`) : [];
	const noticeBox = noticeBody.length && rows - partyBox.length - (noticeBody.length + 2) >= 3 ? frame(NOTICE_TITLE[extras.notice!.level], noticeBody, width, noticeBody.length + 2) : [];
	if (extras.chatShown === false) {
		const lines = [...partyBox, ...noticeBox, fit(`  ${MUTED}alt+c chat · alt+g plain chat${RESET}`, width)];
		return [...lines, ...Array<string>(Math.max(0, rows - lines.length)).fill(" ".repeat(width))].slice(0, rows);
	}
	const chatHeight = rows - partyBox.length - noticeBox.length;
	if (chatHeight < 3) return partyBox.slice(0, rows);
	const body = chat.length === 0 ? [`${MUTED}Write below; the orchestrator answers here.${RESET}`] : chat.slice(-(chatHeight - 2));
	return [...partyBox, ...noticeBox, ...frame("CHAT", body, width, chatHeight, "alt+t thoughts · alt+g plain chat · alt+c hide chat")];
}

/** What an open question shows: its options, which one the ▶ is on, and whether the dialog drives the answer (T4e). */
export interface DialogAsk {
	readonly question: string;
	readonly options: readonly string[];
	/** Pi's list ends with "Other…" for a free-text answer. */
	readonly custom?: boolean;
	readonly selected?: number;
	/** The dialog is the selector: show the keys. */
	readonly interactive?: boolean;
}

/** Columns the orchestrator's portrait takes at the dialog's left (T4b); the text starts one column after it. */
export const PORTRAIT_COLS = 8;
const PORTRAIT_MIN_ROWS = 4;
const PORTRAIT_MIN_COLS = 40;

/** Whether a dialog of this size has room for the portrait. */
export function portraitFits(height: number, width: number): boolean {
	return height >= PORTRAIT_MIN_ROWS && width >= PORTRAIT_MIN_COLS;
}

/* Kitty z-index under text and over cell backgrounds: the portrait shows on the dialog's panel, like a sprite in a text box. */
const ABOVE_BACKGROUNDS = -1;

/** Puts a pi-tui Kitty sequence above cell backgrounds and below text. */
export function aboveBackgrounds(sequence: string): string {
	return sequence.replace("\x1b_Ga=T,", `\x1b_Ga=T,z=${ABOVE_BACKGROUNDS},`);
}

/**
 * The dialog over the room: the current reply in a framed ORCHESTRATOR panel (tail when long), or an open question as a
 * selector. With `portrait`, its Kitty image starts on the first inner row and every line moves PORTRAIT_COLS + 1 right.
 */
export function gameDialog(content: DialogContent, width: number, height: number, portrait?: { image: string }): string[] {
	const boxed = gameDialogBody(content, width, height);
	if (!portrait) return frame(boxed.title, boxed.body, width, height, boxed.footer);
	const pad = " ".repeat(PORTRAIT_COLS + 1);
	const rows = Array.from({ length: Math.max(0, height - 2) }, (_, i) => (i === 0 ? portrait.image : "") + pad + (boxed.body[i] ?? ""));
	return frame(boxed.title, rows, width, height, boxed.footer);
}

/** What the dialog shows: the reply's lines, or an open question. `top` is the reply's first line shown; null follows the tail (T9). */
export interface DialogContent {
	readonly reply: readonly string[];
	readonly ask: DialogAsk | null;
	readonly top?: number | null;
}

/** The first reply line shown: `top` kept inside the text, or the tail when null. */
export function dialogStart(view: { total: number; rows: number }, top: number | null): number {
	const last = Math.max(0, view.total - view.rows);
	return top === null ? last : Math.min(Math.max(0, top), last);
}

export type DialogScrollKey = "line-up" | "line-down" | "page-up" | "page-down";

/** Moves a long reply in the dialog (T9): by one line or by the rows shown. Back at the end it follows the tail again (null). */
export function scrollDialog(top: number | null, view: { total: number; rows: number }, key: DialogScrollKey): number | null {
	const last = Math.max(0, view.total - view.rows);
	if (last === 0) return null;
	const step = key.startsWith("page") ? Math.max(1, view.rows) : 1;
	const next = dialogStart(view, top) + (key.endsWith("up") ? -step : step);
	return next >= last ? null : Math.max(0, next);
}

function gameDialogBody(content: DialogContent, _width: number, height: number): { title: string; body: string[]; footer?: string } {
	const ask = content.ask;
	if (ask) {
		const items = ask.custom ? [...ask.options, "Other… (write your own)"] : [...ask.options];
		const selected = ask.selected ?? 0;
		const body = [
			`${TEXT}${ask.question}${RESET}`,
			...items.map((item, i) => (i === selected ? `${PINK}▶${RESET} ${TEXT}${BOLD}${item}${RESET}` : `  ${MUTED}${item}${RESET}`)),
			...(ask.interactive ? [`${MUTED}↑↓ choose · Enter · Esc${RESET}`] : []),
		];
		return { title: "ORCHESTRATOR · asks", body };
	}
	const view = { total: content.reply.length, rows: Math.max(1, height - 2) };
	const start = dialogStart(view, content.top ?? null);
	const below = Math.max(0, view.total - start - view.rows);
	const marks = [...(start > 0 ? [`↑${start}`] : []), ...(below > 0 ? [`↓${below}`] : [])];
	const footer = marks.length ? [...marks, "PgUp PgDn"].join(" · ") : undefined;
	return { title: "ORCHESTRATOR", body: content.reply.slice(start, start + view.rows), footer };
}

const EDITOR_ROWS = 4;
const ASK_SELECTOR_EXTRA_ROWS = 7;
const PROMPT_ROWS = 12;

/**
 * Rows the overlay leaves free at the bottom for Pi: the editor normally, and enough for Pi's own selector while a
 * question or prompt is open, so its options stay visible and selectable (the dialog over the room only shows them).
 */
export function rowsBelow(open: { askOptions: number | null; prompts: number }): number {
	const ask = open.askOptions === null ? 0 : open.askOptions + ASK_SELECTOR_EXTRA_ROWS;
	const prompt = open.prompts > 0 ? PROMPT_ROWS : 0;
	return Math.max(EDITOR_ROWS, ask, prompt);
}

/* Where each sign sits on the 720 x 408 room (web/hq-scene.js): centre x and row y in room pixels. */
const SIGN_AT = { project: { x: 360, y: 4 }, brew: { x: 191, y: 78 }, brand: { x: 360, y: 402 } } as const;

/**
 * The status as signs in the room (T4f): a framed project-and-branch sign hanging over the chalkboard (its text row and
 * its bottom border), `BREW nn%` (context left) under the coffee corner by the window, and the pink `✿ GENTLE HQ` plaque
 * under the door. `image` is the room image's size in cells.
 */
export function sceneSigns(info: { project: string; branch: string | null; percent: number | null }, image: { cols: number; rows: number }): Sign[] {
	const place = (at: { x: number; y: number }, text: string): Sign => {
		const width = plainWidth(text);
		const col = Math.max(0, Math.min(image.cols - width, Math.round((at.x / HQ_WIDTH) * image.cols - width / 2)));
		const row = Math.min(image.rows - 1, Math.floor((at.y / HQ_HEIGHT) * image.rows));
		return { row, col, text };
	};
	const sign = (fg: string, back: string, text: string) => `${back}${fg}${BOLD}${text}${RESET}`;
	const left = info.percent === null ? "—" : `${Math.round(100 - Math.min(100, Math.max(0, info.percent)))}%`;
	const where = info.branch ? `${info.project} · ${info.branch}` : info.project;
	const room = Math.max(4, image.cols - 2);
	const label = fit(` ${where} `, Math.min(plainWidth(` ${where} `), room - 2));
	const hanging = place(SIGN_AT.project, `║${label}║`);
	const framed = (text: string) => `${PANEL_BG}${BORDER}${text.replaceAll(label, `${GOLD}${BOLD}${label}${RESET}${PANEL_BG}${BORDER}`)}${RESET}`;
	return [
		{ ...hanging, text: framed(`║${label}║`) },
		{ row: Math.min(image.rows - 1, hanging.row + 1), col: hanging.col, text: framed(`╚${"═".repeat(plainWidth(label))}╝`) },
		place(SIGN_AT.brew, sign(SAND, PANEL_BG, ` BREW ${left} `)),
		place(SIGN_AT.brand, sign(INK, PINK_BG, " ✿ GENTLE HQ ")),
	];
}
