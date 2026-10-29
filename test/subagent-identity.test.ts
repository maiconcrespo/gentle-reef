import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	SUBAGENT_LAUNCH_TOOL,
	SubagentIdentityBridge,
	launchIdentityFromArgs,
	taskIdFromLaunchResult,
} from "../src/adapter/subagent-identity.ts";
import type { SubagentEvent } from "../src/contract/office-event.ts";

const notification = (id: string, status: SubagentEvent["status"] = "running"): SubagentEvent => ({
	v: 1,
	type: "subagent",
	id,
	agent: "unknown",
	role: "worker",
	label: "",
	status,
});

const start = (bridge: SubagentIdentityBridge, callId: string, args: unknown) =>
	bridge.piEvent({ type: "tool_execution_start", toolCallId: callId, toolName: SUBAGENT_LAUNCH_TOOL, args });
const end = (bridge: SubagentIdentityBridge, callId: string, result: unknown, isError = false) =>
	bridge.piEvent({ type: "tool_execution_end", toolCallId: callId, toolName: SUBAGENT_LAUNCH_TOOL, result, isError });

describe("launch input becomes an identity", () => {
	it("reads agent and label from the tool input", () => {
		assert.deepEqual(launchIdentityFromArgs({ agent: "gentle-ai-explore", label: "map footer", task: "secret prompt" }), {
			agent: "gentle-ai-explore",
			label: "map footer",
		});
	});

	it("needs a non-empty agent name; a missing label is empty", () => {
		assert.equal(launchIdentityFromArgs({ task: "x" }), undefined);
		assert.equal(launchIdentityFromArgs({ agent: "   " }), undefined);
		assert.equal(launchIdentityFromArgs(undefined), undefined);
		assert.deepEqual(launchIdentityFromArgs({ agent: "gentle-ai-worker", label: 42 }), { agent: "gentle-ai-worker", label: "" });
	});
});

describe("task id is read from the launch result", () => {
	it("prefers the structured details", () => {
		assert.equal(taskIdFromLaunchResult({ content: [{ type: "text", text: "anything" }], details: { gentleAgents: { taskId: "t-9" } } }), "t-9");
	});

	it("falls back to the background text and the task-mode completion text", () => {
		const background = { content: [{ type: "text", text: "Started gentle-ai-worker in the background as task t-42. Retain that id." }] };
		const finished = { content: [{ type: "text", text: 'Subagent gentle-ai-worker (task t-7, "label") finished.\n\nanswer' }] };
		assert.equal(taskIdFromLaunchResult(background), "t-42");
		assert.equal(taskIdFromLaunchResult(finished), "t-7");
	});

	it("returns undefined for results without an id", () => {
		assert.equal(taskIdFromLaunchResult({ content: [{ type: "text", text: "Error: no subagent named x." }] }), undefined);
		assert.equal(taskIdFromLaunchResult(null), undefined);
		assert.equal(taskIdFromLaunchResult("plain string"), undefined);
	});
});

describe("SubagentIdentityBridge", () => {
	it("names a notification after the launch that started it (notification first)", () => {
		const bridge = new SubagentIdentityBridge();
		start(bridge, "call-1", { agent: "gentle-ai-explore", label: "map" });
		const [event] = [bridge.observe(notification("t-1"))];
		assert.equal(event.agent, "gentle-ai-explore");
		assert.equal(event.label, "map");
		assert.equal(event.role, "explore");
		// The result carries the same id: nothing to republish.
		assert.deepEqual(end(bridge, "call-1", { details: { gentleAgents: { taskId: "t-1" } } }), []);
	});

	it("names a notification from the id in the launch result (background launch first)", () => {
		const bridge = new SubagentIdentityBridge();
		start(bridge, "call-1", { agent: "gentle-ai-verify", label: "check" });
		assert.deepEqual(end(bridge, "call-1", { content: [{ type: "text", text: "Started gentle-ai-verify in the background as task t-5." }] }), []);
		assert.equal(bridge.observe(notification("t-5", "completed")).role, "verify");
	});

	it("republishes the identity when a late result corrects an earlier guess", () => {
		const bridge = new SubagentIdentityBridge();
		start(bridge, "call-a", { agent: "gentle-ai-explore", label: "a" });
		start(bridge, "call-b", { agent: "gentle-ai-worker", label: "b" });
		// Notifications arrive in the reverse order: the first unknown id claims call-a.
		assert.equal(bridge.observe(notification("t-2")).agent, "gentle-ai-explore");
		assert.equal(bridge.observe(notification("t-1")).agent, "gentle-ai-worker");
		// The result of call-b says t-2 belongs to it: the bridge must correct t-2.
		const republished = end(bridge, "call-b", { details: { gentleAgents: { taskId: "t-2" } } });
		assert.equal(republished.length, 1);
		assert.equal(republished[0].id, "t-2");
		assert.equal(republished[0].agent, "gentle-ai-worker");
	});

	it("falls back to the pending launch when the result has no id", () => {
		const bridge = new SubagentIdentityBridge();
		start(bridge, "call-1", { agent: "gentle-ai-explore", label: "fallback" });
		assert.deepEqual(end(bridge, "call-1", { content: [{ type: "text", text: "no id here" }] }), []);
		const event = bridge.observe(notification("t-99"));
		assert.equal(event.agent, "gentle-ai-explore");
		assert.equal(event.label, "fallback");
	});

	it("an unknown task with no pending launch stays a generic worker", () => {
		const bridge = new SubagentIdentityBridge();
		const event = bridge.observe(notification("t-orphan"));
		assert.equal(event.agent, "unknown");
		assert.equal(event.role, "worker");
	});

	it("an unrecognised agent name is a generic worker; a review lens is an inspector", () => {
		const bridge = new SubagentIdentityBridge();
		start(bridge, "call-1", { agent: "some-custom-agent", label: "x" });
		assert.equal(bridge.observe(notification("t-1")).role, "worker");
		start(bridge, "call-2", { agent: "review-risk", label: "lens" });
		assert.equal(bridge.observe(notification("t-2")).role, "inspector");
	});

	it("ignores tool events that are not the launch tool", () => {
		const bridge = new SubagentIdentityBridge();
		assert.deepEqual(bridge.piEvent({ type: "tool_execution_start", toolCallId: "c", toolName: "bash", args: { agent: "gentle-ai-explore" } }), []);
		assert.equal(bridge.observe(notification("t-1")).agent, "unknown");
	});

	it("reset forgets every identity", () => {
		const bridge = new SubagentIdentityBridge();
		start(bridge, "call-1", { agent: "gentle-ai-explore", label: "x" });
		bridge.observe(notification("t-1"));
		bridge.reset();
		assert.equal(bridge.observe(notification("t-1")).agent, "unknown");
	});

	it("keeps a bounded number of pending launches", () => {
		const bridge = new SubagentIdentityBridge();
		for (let i = 0; i < 100; i++) start(bridge, `call-${i}`, { agent: "gentle-ai-worker", label: `n${i}` });
		// The oldest launches were dropped: the next unknown id claims the oldest kept one.
		const claimed = bridge.observe(notification("t-first"));
		assert.equal(claimed.agent, "gentle-ai-worker");
		assert.notEqual(claimed.label, "n0");
	});
});
