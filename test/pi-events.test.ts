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
});
