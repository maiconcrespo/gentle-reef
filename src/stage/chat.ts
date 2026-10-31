/**
 * Game mode chat (T4): what the user and the orchestrator say, the tools it calls, and its thinking, read from Pi's own
 * events (input, message_update, message_end, tool_execution_start). Pure: events in, state out, lines for the column.
 */

export type ChatKind = "you" | "orch" | "think" | "tool";

export interface ChatEntry {
	readonly kind: ChatKind;
	readonly text: string;
	/** Tool calls: Pi's toolCallId, so the end event finds its line. */
	readonly id?: string;
	readonly status?: "running" | "ok" | "fail";
	/** Tool calls: when it started, how long it took, and how many lines it returned. */
	readonly at?: number;
	readonly ms?: number;
	readonly lines?: number;
}

export interface ChatState {
	readonly entries: readonly ChatEntry[];
	/** The reply being streamed: its thinking and text so far. Null between replies. */
	readonly live: { readonly thinking: string; readonly text: string } | null;
}

export const CHAT_LIMIT = 60;
const TOOL_DETAIL_LIMIT = 60;
/* The argument that best says what a tool call does, in this order. */
const TOOL_DETAIL_KEYS = ["path", "file_path", "command", "pattern", "query", "url", "agent", "operation"];

const JOB_SCREENS = 12;

/** The monitor wall's jobs (T4b): each tool call since your last message, oldest first, one screen each, at most 12. */
export function jobsFromChat(state: ChatState): Array<"running" | "ok" | "fail"> {
	let start = 0;
	state.entries.forEach((entry, i) => { if (entry.kind === "you") start = i + 1; });
	return state.entries.slice(start).filter(entry => entry.kind === "tool").map(entry => entry.status ?? "running").slice(-JOB_SCREENS);
}

export function initialChat(): ChatState {
	return { entries: [], live: null };
}

type Block = { type?: unknown; text?: unknown; thinking?: unknown; redacted?: unknown };
const blocksOf = (message: unknown): Block[] => {
	const content = (message as { content?: unknown } | null)?.content;
	return Array.isArray(content) ? (content as Block[]) : [];
};
const roleOf = (message: unknown): unknown => (message as { role?: unknown } | null)?.role;
const joined = (blocks: Block[], type: "text" | "thinking"): string =>
	blocks
		.filter(block => block.type === type && block.redacted !== true && typeof block[type] === "string")
		.map(block => (block[type] as string).trim())
		.filter(Boolean)
		.join("\n");

const push = (state: ChatState, ...added: ChatEntry[]): ChatState => ({ ...state, entries: [...state.entries, ...added].slice(-CHAT_LIMIT) });

function toolText(toolName: string, args: unknown): string {
	const record = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	const key = TOOL_DETAIL_KEYS.find(name => typeof record[name] === "string" && (record[name] as string).trim() !== "");
	if (!key) return toolName;
	const detail = (record[key] as string).replace(/\s+/g, " ").trim();
	return `${toolName} ${detail.length > TOOL_DETAIL_LIMIT ? detail.slice(0, TOOL_DETAIL_LIMIT - 1) + "…" : detail}`;
}

/** Lines of text a tool returned: its text content blocks, or the result itself when it is a string. */
function lineCount(result: unknown): number {
	const text = typeof result === "string" ? result : blocksOf(result).filter(block => block.type === "text" && typeof block.text === "string").map(block => block.text as string).join("\n");
	return text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
}

/** Applies one Pi event. Anything it does not show returns the same state. */
export function reduceChat(state: ChatState, event: { readonly type: string; readonly [key: string]: unknown }): ChatState {
	switch (event.type) {
		case "input": {
			const text = typeof event.text === "string" ? event.text.trim() : "";
			return text ? push(state, { kind: "you", text }) : state;
		}
		case "message_update": {
			const partial = (event.assistantMessageEvent as { partial?: unknown } | undefined)?.partial ?? event.message;
			if (roleOf(partial) !== "assistant") return state;
			const blocks = blocksOf(partial);
			return { ...state, live: { thinking: joined(blocks, "thinking"), text: joined(blocks, "text") } };
		}
		case "message_end": {
			if (roleOf(event.message) !== "assistant") return state;
			const blocks = blocksOf(event.message);
			const thinking = joined(blocks, "thinking"), text = joined(blocks, "text");
			const added: ChatEntry[] = [];
			if (thinking) added.push({ kind: "think", text: thinking });
			if (text) added.push({ kind: "orch", text });
			return { ...push(state, ...added), live: null };
		}
		case "tool_execution_start": {
			if (typeof event.toolName !== "string") return state;
			const entry: ChatEntry = {
				kind: "tool",
				text: toolText(event.toolName, event.args),
				...(typeof event.toolCallId === "string" ? { id: event.toolCallId } : {}),
				status: "running",
				...(typeof event.at === "number" ? { at: event.at } : {}),
			};
			return push(state, entry);
		}
		case "tool_execution_end": {
			const index = state.entries.findIndex(entry => entry.kind === "tool" && entry.id !== undefined && entry.id === event.toolCallId);
			if (index < 0) return state;
			const before = state.entries[index]!;
			const ms = typeof event.at === "number" && before.at !== undefined ? { ms: event.at - before.at } : {};
			const done: ChatEntry = { ...before, status: event.isError === true ? "fail" : "ok", ...ms, lines: lineCount(event.result) };
			return { ...state, entries: state.entries.map((entry, i) => (i === index ? done : entry)) };
		}
		default:
			return state;
	}
}

/* Truecolor SGR from the Gentleman-Cute tokens (design/system.md). */
const sgr = (hex: string) => `\x1b[38;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`;
const RESET = "\x1b[0m", ITALIC = "\x1b[3m";
const GOLD = sgr("#E0C27A"), PINK = sgr("#F095C8"), MUTED = sgr("#A78E9B"), BLUE = sgr("#A9C7EE"), TEXT = sgr("#F6EFF3");

/** Word wrap to `width` characters; a word longer than the width is split. Paragraph breaks are kept. */
export function wrap(text: string, width: number): string[] {
	const out: string[] = [];
	const size = Math.max(1, width);
	for (const paragraph of text.split("\n")) {
		let line = "";
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			let rest = word;
			while ([...rest].length > size) {
				if (line) { out.push(line); line = ""; }
				out.push([...rest].slice(0, size).join(""));
				rest = [...rest].slice(size).join("");
			}
			if (!rest) continue;
			const next = line ? `${line} ${rest}` : rest;
			if ([...next].length > size) { out.push(line); line = rest; } else line = next;
		}
		if (line) out.push(line);
	}
	return out;
}

/** Renders markdown to styled lines of at most `width` cells (game mode passes pi-tui's Markdown with Pi's theme). */
export type MarkdownRenderer = (text: string, width: number) => string[];

/** A speaker tag, then the text under it with the same indent: through the markdown renderer when given, else wrapped. */
function said(tag: string, color: string, text: string, width: number, markdown?: MarkdownRenderer): string[] {
	const indent = [...tag].length + 1;
	const body = markdown ? markdown(text, width - indent) : wrap(text, width - indent).map(line => `${TEXT}${line}${RESET}`);
	return body.map((line, i) => (i === 0 ? `${color}${tag}${RESET} ${line}` : `${" ".repeat(indent)}${line}`));
}
const thought = (text: string, width: number): string[] => wrap(text, width - 2).map(line => `${PINK}┆${RESET} ${MUTED}${ITALIC}${line}${RESET}`);

const GREEN = sgr("#B4E7C7"), RED = sgr("#FF718F");
/** A tool call as battle text: `▸ bash grep x` and its outcome, `…` while running, `✓ 0.4s · 69 lines` or `✗ 1.5s`. */
function toolLines(entry: ChatEntry, width: number): string[] {
	const seconds = entry.ms === undefined ? "" : ` ${(entry.ms / 1000).toFixed(1)}s`;
	const outcome = entry.status === "ok" ? `${GREEN}✓${seconds}${entry.lines ? ` · ${entry.lines} lines` : ""}${RESET}` : entry.status === "fail" ? `${RED}✗${seconds}${RESET}` : entry.status === "running" ? `${MUTED}…${RESET}` : "";
	const body = wrap(entry.text, width - 2);
	return body.map((line, i) => `${i === 0 ? `${BLUE}▸${RESET}` : " "} ${MUTED}${line}${RESET}${i === body.length - 1 && outcome ? ` ${outcome}` : ""}`);
}

/** The chat column's lines, oldest first. Thoughts show only when `thoughtsShown` (alt+t). */
export function chatLines(state: ChatState, options: { width: number; thoughtsShown: boolean; markdown?: MarkdownRenderer }): string[] {
	const { width, thoughtsShown, markdown } = options;
	const lines: string[] = [];
	for (const entry of state.entries) {
		if (entry.kind === "you") lines.push(...said("YOU", PINK, entry.text, width));
		else if (entry.kind === "orch") lines.push(...said("ORCH", GOLD, entry.text, width, markdown));
		else if (entry.kind === "tool") lines.push(...toolLines(entry, width));
		else if (thoughtsShown) lines.push(...thought(entry.text, width));
	}
	if (state.live?.thinking) {
		if (thoughtsShown) lines.push(`${PINK}thinking · live${RESET}`, ...thought(`${state.live.thinking}▌`, width));
		else lines.push(`${MUTED}… thinking · alt+t to show${RESET}`);
	}
	if (state.live?.text) lines.push(...said("ORCH", GOLD, `${state.live.text}▌`, width, markdown));
	return lines;
}

/**
 * What the dialog over the room shows (T4d): the orchestrator's text since your last message, plus what streams now
 * (with a cursor). Null until the reply starts, so the dialog closes while it thinks.
 */
export function currentReply(state: ChatState): string | null {
	let since = 0;
	state.entries.forEach((entry, i) => { if (entry.kind === "you") since = i + 1; });
	const parts = state.entries.slice(since).filter(entry => entry.kind === "orch").map(entry => entry.text);
	if (state.live?.text) parts.push(`${state.live.text}▌`);
	return parts.length ? parts.join("\n\n") : null;
}
