import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHAT_LIMIT, chatLines, currentReply, initialChat, reduceChat, wrap } from "../src/stage/chat.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const assistant = (content: unknown[]) => ({ role: "assistant", content });
const update = (content: unknown[]) => ({ type: "message_update", message: assistant(content), assistantMessageEvent: { type: "text_delta", partial: assistant(content) } });

describe("chat log (T4): Pi events in, entries out", () => {
	it("your input becomes a YOU entry; blank input is ignored", () => {
		let s = reduceChat(initialChat(), { type: "input", text: "  arranca el spike  ", source: "interactive" });
		assert.deepEqual(s.entries, [{ kind: "you", text: "arranca el spike" }]);
		const same = reduceChat(s, { type: "input", text: "   ", source: "interactive" });
		assert.equal(same, s, "no change, same state");
	});

	it("while the reply streams, live holds the thinking and the text so far", () => {
		const s = reduceChat(initialChat(), update([{ type: "thinking", thinking: "check pi-tui" }, { type: "text", text: "Voy" }]));
		assert.deepEqual(s.live, { thinking: "check pi-tui", text: "Voy" });
		assert.deepEqual(s.entries, []);
	});

	it("message_end turns the reply into a thought entry and an ORCH entry, and clears live", () => {
		let s = reduceChat(initialChat(), update([{ type: "thinking", thinking: "x" }]));
		s = reduceChat(s, { type: "message_end", message: assistant([{ type: "thinking", thinking: "check pi-tui" }, { type: "text", text: "Listo." }, { type: "toolCall", id: "1", name: "read", arguments: {} }]) });
		assert.deepEqual(s.entries, [{ kind: "think", text: "check pi-tui" }, { kind: "orch", text: "Listo." }]);
		assert.equal(s.live, null);
	});

	it("redacted thinking is not shown, and a user message_end adds nothing (input already did)", () => {
		let s = reduceChat(initialChat(), { type: "message_end", message: assistant([{ type: "thinking", thinking: "secret", redacted: true }, { type: "text", text: "ok" }]) });
		assert.deepEqual(s.entries, [{ kind: "orch", text: "ok" }]);
		const same = reduceChat(s, { type: "message_end", message: { role: "user", content: "hola" } });
		assert.equal(same, s);
	});

	it("a tool call is one line with its most telling argument, cut to 60 characters", () => {
		let s = reduceChat(initialChat(), { type: "tool_execution_start", toolName: "read", args: { path: "web/office-engine.js" } });
		s = reduceChat(s, { type: "tool_execution_start", toolName: "bash", args: { command: "x".repeat(80) } });
		s = reduceChat(s, { type: "tool_execution_start", toolName: "todo", args: { action: "list" } });
		assert.deepEqual(s.entries.map(e => e.text), ["read web/office-engine.js", `bash ${"x".repeat(59)}…`, "todo"]);
	});

	it("a tool call ends as ✓ or ✗ with its time and how many lines it returned", () => {
		let s = reduceChat(initialChat(), { type: "tool_execution_start", toolName: "bash", toolCallId: "c1", args: { command: "grep x" }, at: 1000 });
		assert.deepEqual(s.entries, [{ kind: "tool", text: "bash grep x", id: "c1", status: "running", at: 1000 }]);
		s = reduceChat(s, { type: "tool_execution_end", toolName: "bash", toolCallId: "c1", isError: false, result: { content: [{ type: "text", text: "a\nb\nc" }] }, at: 1400 });
		assert.deepEqual(s.entries[0], { kind: "tool", text: "bash grep x", id: "c1", status: "ok", at: 1000, ms: 400, lines: 3 });
		s = reduceChat(s, { type: "tool_execution_start", toolName: "read", toolCallId: "c2", args: { path: "x" }, at: 2000 });
		s = reduceChat(s, { type: "tool_execution_end", toolName: "read", toolCallId: "c2", isError: true, result: "boom", at: 2100 });
		assert.equal(s.entries[1]!.status, "fail");
		assert.equal(s.entries[1]!.lines, 1);
		assert.equal(reduceChat(s, { type: "tool_execution_end", toolName: "x", toolCallId: "nope", isError: false }), s, "unknown call: no change");
	});

	it("tool lines show … while running, then ✓ time · lines or ✗", () => {
		const lines = chatLines({ entries: [
			{ kind: "tool", text: "bash a", status: "running" },
			{ kind: "tool", text: "bash b", status: "ok", ms: 400, lines: 69 },
			{ kind: "tool", text: "read c", status: "fail", ms: 1500, lines: 1 },
		], live: null }, { width: 60, thoughtsShown: true }).map(plain);
		assert.deepEqual(lines, ["▸ bash a …", "▸ bash b ✓ 0.4s · 69 lines", "▸ read c ✗ 1.5s"]);
	});

	it(`keeps the last ${CHAT_LIMIT} entries`, () => {
		let s = initialChat();
		for (let i = 0; i < CHAT_LIMIT + 5; i++) s = reduceChat(s, { type: "input", text: `m${i}`, source: "interactive" });
		assert.equal(s.entries.length, CHAT_LIMIT);
		assert.equal(s.entries[0]!.text, "m5");
	});

	it("other events change nothing", () => {
		const s = initialChat();
		assert.equal(reduceChat(s, { type: "turn_start" }), s);
	});
});

describe("chat lines", () => {
	const state = {
		entries: [
			{ kind: "you", text: "hola" },
			{ kind: "think", text: "saludar" },
			{ kind: "tool", text: "read a.ts" },
			{ kind: "orch", text: "Hola, ¿en qué andamos?" },
		],
		live: null,
	} as const;

	it("YOU and ORCH lines, tools with ▸, thoughts as a dashed block when shown", () => {
		assert.deepEqual(chatLines(state, { width: 40, thoughtsShown: true }).map(plain), ["YOU hola", "┆ saludar", "▸ read a.ts", "ORCH Hola, ¿en qué andamos?"]);
	});

	it("hidden thoughts leave no line", () => {
		assert.deepEqual(chatLines(state, { width: 40, thoughtsShown: false }).map(plain), ["YOU hola", "▸ read a.ts", "ORCH Hola, ¿en qué andamos?"]);
	});

	it("the live thought streams with a cursor when shown, or a one-line hint when hidden", () => {
		const live = { entries: [], live: { thinking: "mirando el engine", text: "" } };
		assert.deepEqual(chatLines(live, { width: 40, thoughtsShown: true }).map(plain), ["thinking · live", "┆ mirando el engine▌"]);
		assert.deepEqual(chatLines(live, { width: 40, thoughtsShown: false }).map(plain), ["… thinking · alt+t to show"]);
	});

	it("the reply streams after the thought with a cursor", () => {
		const live = { entries: [], live: { thinking: "", text: "Voy a" } };
		assert.deepEqual(chatLines(live, { width: 40, thoughtsShown: true }).map(plain), ["ORCH Voy a▌"]);
	});

	it("long text wraps at word boundaries to the column width, keeping the speaker indent", () => {
		const long = { entries: [{ kind: "orch", text: "uno dos tres cuatro cinco" }], live: null } as const;
		assert.deepEqual(chatLines(long, { width: 14, thoughtsShown: true }).map(plain), ["ORCH uno dos", "     tres", "     cuatro", "     cinco"]);
	});

	it("ORCH replies go through the markdown renderer when one is given, indented under the tag", () => {
		const md = (text: string, width: number) => [`<${text}:${width}>`, "second"];
		const lines = chatLines({ entries: [{ kind: "orch", text: "## Hola" }], live: null }, { width: 20, thoughtsShown: true, markdown: md }).map(plain);
		assert.deepEqual(lines, ["ORCH <## Hola:15>", "     second"]);
	});

	it("wrap splits a word longer than the width", () => {
		assert.deepEqual(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"]);
	});
});

describe("current reply (what the dialog shows)", () => {
	it("is the orchestrator's text since your last message, plus what is streaming now", () => {
		assert.equal(currentReply(initialChat()), null);
		const s = { entries: [{ kind: "orch", text: "old" }, { kind: "you", text: "hola" }, { kind: "tool", text: "read x" }, { kind: "orch", text: "Primero" }], live: { thinking: "", text: "y después" } } as const;
		assert.equal(currentReply(s), "Primero\n\ny después▌");
	});

	it("is null right after you write, until the reply starts", () => {
		assert.equal(currentReply({ entries: [{ kind: "orch", text: "old" }, { kind: "you", text: "hola" }], live: { thinking: "pensando", text: "" } }), null);
	});
});
