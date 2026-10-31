import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { piEventToOffice, type PiEvent } from "../src/adapter/pi-events.ts";

describe("piEventToOffice", () => {
	it("maps agent_start and turn_start to the thinking orchestrator", () => {
		assert.deepEqual(piEventToOffice({ type: "agent_start" }), [{ v: 1, type: "orchestrator", state: "thinking" }]);
		assert.deepEqual(piEventToOffice({ type: "turn_start" }), [{ v: 1, type: "orchestrator", state: "thinking" }]);
	});

	it("maps agent_settled to idle", () => {
		assert.deepEqual(piEventToOffice({ type: "agent_settled" }), [{ v: 1, type: "orchestrator", state: "idle" }]);
	});

	it("reports context usage on turn_end only when the caller supplies a reading", () => {
		assert.deepEqual(piEventToOffice({ type: "turn_end" }), []);
		assert.deepEqual(piEventToOffice({ type: "turn_end" }, { percent: 42 }), [{ v: 1, type: "context", percent: 42 }]);
	});

	it("maps a tool start to tool activity, tool state and a feature signal", () => {
		assert.deepEqual(piEventToOffice({ type: "tool_execution_start", toolName: "mem_save" }), [
			{ v: 1, type: "tool", actor: "orchestrator", toolName: "mem_save", phase: "start" },
			{ v: 1, type: "orchestrator", state: "tool", toolName: "mem_save" },
			{ v: 1, type: "feature", feature: "memory", detail: "mem_save" },
		]);
	});

	it("maps an ask_user tool start to waiting-user with an ask feature", () => {
		assert.deepEqual(piEventToOffice({ type: "tool_execution_start", toolName: "ask_user_question" }), [
			{ v: 1, type: "tool", actor: "orchestrator", toolName: "ask_user_question", phase: "start" },
			{ v: 1, type: "orchestrator", state: "waiting-user", toolName: "ask_user_question" },
			{ v: 1, type: "feature", feature: "ask", detail: "ask_user_question" },
		]);
	});

	it("maps a plain tool start without a feature signal", () => {
		assert.deepEqual(piEventToOffice({ type: "tool_execution_start", toolName: "bash" }), [
			{ v: 1, type: "tool", actor: "orchestrator", toolName: "bash", phase: "start" },
			{ v: 1, type: "orchestrator", state: "tool", toolName: "bash" },
		]);
	});

	it("maps tool end to ok from isError and returns the orchestrator to thinking", () => {
		assert.deepEqual(piEventToOffice({ type: "tool_execution_end", toolName: "bash", isError: false }), [
			{ v: 1, type: "tool", actor: "orchestrator", toolName: "bash", phase: "end", ok: true },
			{ v: 1, type: "orchestrator", state: "thinking" },
		]);
		assert.deepEqual(piEventToOffice({ type: "tool_execution_end", toolName: "bash", isError: true })[0], {
			v: 1, type: "tool", actor: "orchestrator", toolName: "bash", phase: "end", ok: false,
		});
	});

	it("maps compaction start, end and failure", () => {
		assert.deepEqual(piEventToOffice({ type: "session_before_compact" }), [{ v: 1, type: "compaction", phase: "start" }]);
		assert.deepEqual(piEventToOffice({ type: "session_compact" }), [{ v: 1, type: "compaction", phase: "end" }]);
		assert.deepEqual(piEventToOffice({ type: "session_compact_failed" }), [{ v: 1, type: "compaction", phase: "failed" }]);
	});

	it("ignores Pi events the office does not render", () => {
		assert.deepEqual(piEventToOffice({ type: "message_update" } as unknown as PiEvent), []);
	});

	it("opens an ask dialog with each question and its option labels from ask_user_question args", () => {
		const out = piEventToOffice({
			type: "tool_execution_start",
			toolName: "ask_user_question",
			args: { questions: [
				{ header: "Dialog", question: "Show only or answer too?", multiSelect: false, options: [{ label: "Show only", description: "d1" }, { label: "Show and answer", description: "d2" }] },
				{ header: "Fixes", question: "Start now?", multiSelect: true, options: [{ label: "Yes", description: "" }, { label: "After T9", description: "" }] },
			] },
		});
		assert.deepEqual(out.at(-1), {
			v: 1, type: "ask", phase: "open", questions: [
				{ header: "Dialog", question: "Show only or answer too?", options: ["Show only", "Show and answer"], multiSelect: false },
				{ header: "Fixes", question: "Start now?", options: ["Yes", "After T9"], multiSelect: true },
			],
		});
	});

	it("marks an ask_user_choice question that allows a custom answer, so the game dialog can offer Other… (T4e)", () => {
		const out = piEventToOffice({ type: "tool_execution_start", toolName: "ask_user_choice", args: { question: "Push?", options: [{ label: "Yes" }, { label: "No" }], allowCustomResponse: true } });
		assert.deepEqual(out.at(-1), { v: 1, type: "ask", phase: "open", questions: [{ question: "Push?", options: ["Yes", "No"], multiSelect: false, custom: true }] });
	});

	it("opens an ask dialog from ask_user_choice args, without a header", () => {
		const out = piEventToOffice({
			type: "tool_execution_start",
			toolName: "ask_user_choice",
			args: { question: "Which floor color?", options: [{ label: "Lighter", description: "x", value: "a" }, { label: "Dusty rose", description: "y", value: "b" }] },
		});
		assert.deepEqual(out.at(-1), { v: 1, type: "ask", phase: "open", questions: [{ question: "Which floor color?", options: ["Lighter", "Dusty rose"], multiSelect: false }] });
	});

	it("bounds the dialog: at most 4 questions, 4 options each, 300 characters per text, and drops malformed entries", () => {
		const long = "x".repeat(500);
		const out = piEventToOffice({
			type: "tool_execution_start",
			toolName: "ask_user_question",
			args: { questions: [
				{ question: long, options: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }, { label: "e" }, { nope: 1 }] },
				{ question: 42, options: [] },
				{ question: "q2", options: [{ label: "a" }] },
				{ question: "q3", options: [{ label: "a" }] },
				{ question: "q4", options: [{ label: "a" }] },
				{ question: "q5", options: [{ label: "a" }] },
			] },
		});
		const ask = out.at(-1) as { questions: { question: string; options: string[] }[] };
		assert.equal(ask.questions.length, 4);
		assert.equal(ask.questions[0]!.question, "x".repeat(299) + "…");
		assert.deepEqual(ask.questions[0]!.options, ["a", "b", "c", "d"]);
		assert.deepEqual(ask.questions.map(q => q.question).slice(1), ["q2", "q3", "q4"]);
	});

	it("emits no ask dialog when the ask args carry no readable question", () => {
		const out = piEventToOffice({ type: "tool_execution_start", toolName: "ask_user_choice", args: { question: "" } });
		assert.equal(out.some(event => event.type === "ask"), false);
	});

	it("closes the ask dialog when the ask tool ends, and only then", () => {
		assert.deepEqual(piEventToOffice({ type: "tool_execution_end", toolName: "ask_user_choice", isError: false }).at(-1), { v: 1, type: "ask", phase: "close" });
		assert.equal(piEventToOffice({ type: "tool_execution_end", toolName: "bash", isError: false }).some(event => event.type === "ask"), false);
	});
});
