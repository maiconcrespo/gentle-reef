import type { OfficeSnapshot } from "../adapter/hub.ts";
import { HQ_HEIGHT, HQ_WIDTH } from "../../web/hq-scene.js";

/** Game mode (T3): the Gentle HQ layout drawn over Pi's chat. Row 0 is the HUD; below it, the room and a text column. */
export interface GameLayout {
	readonly hudRows: number;
	readonly bodyRows: number;
	/** Cells the room image takes, left. */
	readonly roomCols: number;
	/** Cells between the room and the text column (" │ "). */
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
		lines.push(fit(content.room[row] ?? "", layout.roomCols) + " │ " + fit(content.side[row] ?? "", layout.sideCols));
	}
	return lines;
}

/* Truecolor SGR from the Gentleman-Cute tokens (design/system.md). */
const sgr = (hex: string) => `\x1b[38;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`;
const RESET = "\x1b[0m";
const GOLD = sgr("#E0C27A"), PINK = sgr("#F095C8"), MUTED = sgr("#A78E9B"), SAND = sgr("#F2B86D");

const IN_FLIGHT: ReadonlySet<string> = new Set(["queued", "running", "waiting"]);
const ORCHESTRATOR_TEXT: Record<string, string> = { idle: "resting", thinking: "at the whiteboard", tool: "at the whiteboard", "waiting-user": "waiting for you" };

/** The HUD row: brand, project, context used, and the key back to plain Pi. */
export function gameHud(snapshot: OfficeSnapshot, info: { project: string }): string {
	const percent = snapshot.context.percent;
	const ctx = percent === null ? "ctx —" : `ctx ${Math.round(percent)}%`;
	return ` ${GOLD}✿ GENTLE HQ${RESET} · ${info.project} · ${SAND}${ctx}${RESET} · ${MUTED}alt+g plain chat${RESET}`;
}

/** The text column: the party (orchestrator first, then each agent in flight), then the chat (T4 fills it). */
export function gameSide(snapshot: OfficeSnapshot): string[] {
	const row = (name: string, text: string) => `${PINK}▶${RESET} ${name.padEnd(14)}${MUTED}${text}${RESET}`;
	return [
		`${GOLD}PARTY${RESET}`,
		row("orchestrator", ORCHESTRATOR_TEXT[snapshot.orchestrator.state] ?? snapshot.orchestrator.state),
		...snapshot.agents.filter(agent => IN_FLIGHT.has(agent.status)).map(agent => row(agent.role, agent.status)),
		"",
		`${GOLD}CHAT${RESET}`,
		`${MUTED}Messages, live thoughts and confirmations arrive here (T4).${RESET}`,
	];
}
