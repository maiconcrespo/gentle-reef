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

describe("review inspectors: native review tool calls (T1, S3)", () => {
	const reviewOf = (out: readonly { type: string }[]) => out.filter(event => event.type === "review");
	const start = (toolName: string, args: unknown) => piEventToOffice({ type: "tool_execution_start", toolName, args } as PiEvent);
	const end = (toolName: string, result: unknown, isError = false) => piEventToOffice({ type: "tool_execution_end", toolName, isError, result } as PiEvent);
	const text = (value: string) => ({ content: [{ type: "text", text: value }] });

	it("arrives at a gentle_review start or inspect call", () => {
		assert.deepEqual(reviewOf(start("gentle_review", { operation: "start" })), [{ v: 1, type: "review", phase: "arrive" }]);
		assert.deepEqual(reviewOf(start("gentle_review", { operation: "inspect" })), [{ v: 1, type: "review", phase: "arrive" }]);
	});

	it("emits nothing for other gentle_review operations at start", () => {
		assert.deepEqual(reviewOf(start("gentle_review", { operation: "status" })), []);
		assert.deepEqual(reviewOf(start("gentle_review", { operation: "assess" })), []);
		assert.deepEqual(reviewOf(start("gentle_review", { operation: "acknowledge-approved" })), []);
		assert.deepEqual(reviewOf(start("gentle_review", undefined)), []);
	});

	it("names the lenses a start call asks for: known names only, in order, from a JSON string or an object", () => {
		const fromString = start("gentle_review", { operation: "start", input: JSON.stringify({ mode: "ordinary", lenses: ["reliability", "made-up", "risk"], lensesReason: "x" }) });
		assert.deepEqual(reviewOf(fromString), [{ v: 1, type: "review", phase: "arrive", names: ["reliability", "risk"] }]);
		const fromObject = start("gentle_review", { operation: "start", input: { lenses: ["risk"] } });
		assert.deepEqual(reviewOf(fromObject), [{ v: 1, type: "review", phase: "arrive", names: ["risk"] }]);
		assert.deepEqual(reviewOf(start("gentle_review", { operation: "start", input: "{not json" })), [{ v: 1, type: "review", phase: "arrive" }]);
	});

	it("shows inspectors only for a capture that runs: the forecast call (no acknowledgement) runs nothing", () => {
		assert.deepEqual(reviewOf(start("gentle_review_capture", { lineageId: "l" })), []);
		assert.deepEqual(reviewOf(start("gentle_review_capture", { lineageId: "l", reviewerRunAcknowledged: false })), []);
		assert.deepEqual(reviewOf(start("gentle_review_capture", { lineageId: "l", reviewerRunAcknowledged: true })), [{ v: 1, type: "review", phase: "inspect", count: 1 }]);
	});

	it("counts the lenses of an acknowledged group capture, bounded to four, and needs at least one binding", () => {
		const bindings = (n: number) => Array.from({ length: n }, (_, i) => `binding-${i}`);
		assert.deepEqual(reviewOf(start("gentle_review_capture_group", { lineageId: "l", collectBindings: bindings(3), reviewerRunAcknowledged: true })), [{ v: 1, type: "review", phase: "inspect", count: 3 }]);
		assert.deepEqual(reviewOf(start("gentle_review_capture_group", { lineageId: "l", collectBindings: bindings(9), reviewerRunAcknowledged: true })), [{ v: 1, type: "review", phase: "inspect", count: 4 }]);
		assert.deepEqual(reviewOf(start("gentle_review_capture_group", { lineageId: "l", collectBindings: bindings(3) })), []);
		assert.deepEqual(reviewOf(start("gentle_review_capture_group", { lineageId: "l", collectBindings: [], reviewerRunAcknowledged: true })), []);
	});

	it("reads the verdict of a capture: approved, correction_required, or failed on error", () => {
		assert.deepEqual(reviewOf(end("gentle_review_capture", text('{"state":"approved"}'))), [{ v: 1, type: "review", phase: "verdict", verdict: "approved" }]);
		assert.deepEqual(reviewOf(end("gentle_review_capture_group", text('{"state": "approved"}'))), [{ v: 1, type: "review", phase: "verdict", verdict: "approved" }]);
		assert.deepEqual(reviewOf(end("gentle_review_capture_group", text('{"state":"correction_required"}'))), [{ v: 1, type: "review", phase: "verdict", verdict: "correction" }]);
		assert.deepEqual(reviewOf(end("gentle_review_capture", text("boom"), true)), [{ v: 1, type: "review", phase: "verdict", verdict: "failed" }]);
	});

	it("reads the verdict from the result details too, not only from the text", () => {
		assert.deepEqual(reviewOf(end("gentle_review_capture", { details: { closure: { state: "approved" } }, "state": "approved" })), [{ v: 1, type: "review", phase: "verdict", verdict: "approved" }]);
	});

	it("does not read a forecast as a verdict, even when it mentions an approved state", () => {
		assert.deepEqual(reviewOf(end("gentle_review_capture", text('{"outcome":"reviewer-model-run-forecast","state":"approved"}'))), []);
		assert.deepEqual(reviewOf(end("gentle_review_capture", text("reviewer-model-run-forecast"), true)), []);
	});

	it("emits no verdict for an unrecognised capture result, and never throws on odd shapes", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const shapes: unknown[] = [undefined, null, 42, circular, { details: circular }, text("x".repeat(100_000)), { content: "nope" }];
		for (const result of shapes) assert.doesNotThrow(() => end("gentle_review_capture", result));
		assert.deepEqual(reviewOf(end("gentle_review_capture", circular)), []);
		assert.deepEqual(reviewOf(end("gentle_review_capture", text("x".repeat(100_000)))), []);
	});

	it("acknowledges an approved review when the acknowledgement result completes, and only then", () => {
		assert.deepEqual(reviewOf(end("gentle_review", text('{"outcome":"native-approved-acknowledgement-completed"}'))), [{ v: 1, type: "review", phase: "acknowledged" }]);
		assert.deepEqual(reviewOf(end("gentle_review", text('{"outcome":"something-else"}'))), []);
		assert.deepEqual(reviewOf(end("gentle_review", text('{"outcome":"native-approved-acknowledgement-completed"}'), true)), []);
	});

	it("ignores tools that are not review tools, and keeps the review feature signal", () => {
		assert.deepEqual(reviewOf(end("bash", text('{"state":"approved"}'))), []);
		assert.deepEqual(reviewOf(start("gentle_design", { operation: "start" })), []);
		assert.deepEqual(start("gentle_review_capture", { reviewerRunAcknowledged: true }).filter(event => event.type === "feature"), [{ v: 1, type: "feature", feature: "review", detail: "gentle_review_capture" }]);
	});
});
