import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	GENTLE_NOTIFICATION_SOURCE_EVENT,
	subagentFromNotification,
	subagentFromRecord,
	toOfficeTaskStatus,
} from "../src/adapter/task-status.ts";

describe("toOfficeTaskStatus", () => {
	it("passes through every gentle-pi task status", () => {
		for (const status of ["queued", "running", "waiting", "completed", "failed", "cancelled", "timed_out"]) {
			assert.equal(toOfficeTaskStatus(status), status);
		}
	});

	it("drops unknown, non-string and prototype-key statuses", () => {
		assert.equal(toOfficeTaskStatus("paused"), undefined);
		assert.equal(toOfficeTaskStatus(42), undefined);
		assert.equal(toOfficeTaskStatus(null), undefined);
		assert.equal(toOfficeTaskStatus("constructor"), undefined);
	});
});

describe("subagentFromRecord", () => {
	it("maps a gentle-pi task record to a subagent lifecycle event", () => {
		assert.deepEqual(
			subagentFromRecord({ id: "t1", agent: "gentle-ai-explore", label: "map the repo", status: "running", parentSessionId: "s1", tokens: 1200, cost: 0.02 }),
			{ v: 1, type: "subagent", id: "t1", agent: "gentle-ai-explore", role: "explore", label: "map the repo", status: "running", parentSessionId: "s1", tokens: 1200, cost: 0.02 },
		);
	});

	it("omits tokens and cost when the record does not carry them", () => {
		const event = subagentFromRecord({ id: "t2", agent: "review-security", label: "scan", status: "completed", parentSessionId: "s1" });
		assert.deepEqual(event, { v: 1, type: "subagent", id: "t2", agent: "review-security", role: "inspector", label: "scan", status: "completed", parentSessionId: "s1" });
	});

	it("returns undefined for a status outside the contract", () => {
		assert.equal(subagentFromRecord({ id: "t3", agent: "gentle-ai-worker", label: "", status: "paused", parentSessionId: "s1" }), undefined);
	});
});

describe("subagentFromNotification", () => {
	it("maps a gentle-pi subagent status notification; the agent stays unknown", () => {
		assert.deepEqual(
			subagentFromNotification({ source: "subagent", taskId: "t9", status: "failed", parentSessionId: "s1", event: "subagent.failed" }),
			{ v: 1, type: "subagent", id: "t9", agent: "unknown", role: "worker", label: "", status: "failed", parentSessionId: "s1" },
		);
	});

	it("ignores notifications from other sources, without a task id, or with an unknown status", () => {
		assert.equal(subagentFromNotification({ source: "main", event: "agent.completed" }), undefined);
		assert.equal(subagentFromNotification({ source: "subagent", status: "running" }), undefined);
		assert.equal(subagentFromNotification({ source: "subagent", taskId: "t9", status: "paused" }), undefined);
		assert.equal(subagentFromNotification(null), undefined);
	});
});

it("listens on the gentle-pi notification channel that carries task status", () => {
	assert.equal(GENTLE_NOTIFICATION_SOURCE_EVENT, "gentle-pi:notification:source");
});
