import type { OfficeSnapshot } from "../adapter/hub.ts";
import { HQ_HEIGHT, HQ_WIDTH } from "../../web/hq-scene.js";

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

const HUD_ROWS = 1;
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
export function composeGame(layout: GameLayout, content: { hud: string; room: readonly string[]; side: readonly string[] }): string[] {
	const width = layout.roomCols + layout.gap + layout.sideCols;
	const lines = [fit(content.hud, width)];
	for (let row = 0; row < layout.bodyRows; row++) {
		lines.push(fit(content.room[row] ?? "", layout.roomCols) + " ".repeat(layout.gap) + fit(content.side[row] ?? "", layout.sideCols));
	}
	return lines;
}

/* Truecolor SGR from the Gentleman-Cute tokens (design/system.md). */
const sgr = (hex: string) => `\x1b[38;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`;
const RESET = "\x1b[0m";
const GOLD = sgr("#E0C27A"), PINK = sgr("#F095C8"), MUTED = sgr("#A78E9B"), SAND = sgr("#F2B86D");

const IN_FLIGHT: ReadonlySet<string> = new Set(["queued", "running", "waiting"]);
const ORCHESTRATOR_TEXT: Record<string, string> = { idle: "resting", thinking: "at the whiteboard", tool: "at the whiteboard", "waiting-user": "waiting for you" };

const bg = (hex: string) => `\x1b[48;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`;
const INK = sgr("#060407"), BORDER = sgr("#C96AA2"), TEXT = sgr("#F6EFF3");
const PANEL_BG = bg("#100A0F"), BADGE_BG = bg("#E0C27A"), BOLD = "\x1b[1m";

/** The HUD row: the gold badge, the brew cups (context left, like Zelda hearts), the project, and the keys. */
export function gameHud(snapshot: OfficeSnapshot, info: { project: string }): string {
	const percent = snapshot.context.percent;
	const left = percent === null ? 1 : 1 - Math.min(100, Math.max(0, percent)) / 100;
	const full = Math.round(left * 10);
	const cups = `${SAND}${"▮".repeat(full)}${MUTED}${"▯".repeat(10 - full)}${RESET}`;
	const pct = percent === null ? "—" : `${Math.round(left * 100)}%`;
	return ` ${BADGE_BG}${INK}${BOLD}✿ GENTLE HQ${RESET}  ${MUTED}BREW${RESET} ${cups} ${SAND}${pct}${RESET}  ${TEXT}${info.project}${RESET}  ${MUTED}alt+t thoughts · alt+g plain chat${RESET}`;
}

/** A framed panel like the design's boxes: a gold title in the top border, the body padded inside, panel background. */
export function frame(title: string, body: readonly string[], width: number, height: number): string[] {
	const inner = Math.max(1, width - 4);
	const paint = (line: string) => PANEL_BG + line.replaceAll(RESET, RESET + PANEL_BG) + RESET;
	const top = `${BORDER}╔═ ${GOLD}${BOLD}${title}${RESET}${BORDER} ${"═".repeat(Math.max(0, width - 5 - [...title].length))}╗${RESET}`;
	const rows = Array.from({ length: Math.max(0, height - 2) }, (_, i) => `${BORDER}║${RESET} ${fit(body[i] ?? "", inner)} ${BORDER}║${RESET}`);
	return [top, ...rows, `${BORDER}╚${"═".repeat(Math.max(0, width - 2))}╝${RESET}`].map(paint);
}

/** The text column: a PARTY box (orchestrator, then each agent in flight) and a CHAT box with as much chat as fits, newest last. */
export function gameSide(snapshot: OfficeSnapshot, chat: readonly string[], rows: number, width: number): string[] {
	const row = (name: string, text: string) => `${PINK}▶${RESET} ${TEXT}${name.padEnd(14)}${RESET}${MUTED}${text}${RESET}`;
	const party = [
		row("orchestrator", ORCHESTRATOR_TEXT[snapshot.orchestrator.state] ?? snapshot.orchestrator.state),
		...snapshot.agents.filter(agent => IN_FLIGHT.has(agent.status)).map(agent => row(agent.role, agent.status)),
	];
	const partyBox = frame("PARTY", party, width, party.length + 2);
	const chatHeight = rows - partyBox.length;
	if (chatHeight < 3) return partyBox.slice(0, rows);
	const body = chat.length === 0 ? [`${MUTED}Write below; the orchestrator answers here.${RESET}`] : chat.slice(-(chatHeight - 2));
	return [...partyBox, ...frame("CHAT", body, width, chatHeight)];
}
