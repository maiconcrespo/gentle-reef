import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficeHub } from "../src/adapter/hub.ts";
import { registerOffice } from "../src/toggle.ts";

type Handler = (...args: any[]) => unknown;

// Fake Pi host with just enough surface for registerOffice: Pi events and the gentle-pi notification channel.
function fakeHost() {
	const piHandlers = new Map<string, Handler[]>();
	const channelHandlers = new Map<string, Handler[]>();
	let command: Handler | undefined;
	const host = {
		on(name: string, handler: Handler) { piHandlers.set(name, [...(piHandlers.get(name) ?? []), handler]); return () => undefined; },
		events: { on(channel: string, handler: Handler) { channelHandlers.set(channel, [...(channelHandlers.get(channel) ?? []), handler]); return () => undefined; } },
		registerCommand(_name: string, options: { handler: Handler }) { command = options.handler; },
	};
	return {
		host,
		run: (args: string) => command!(args, { ui: { notify: () => undefined } }),
		emitPi: (name: string, event: unknown) => { for (const handler of piHandlers.get(name) ?? []) handler(event, undefined); },
		emitChannel: (channel: string, data: unknown) => { for (const handler of channelHandlers.get(channel) ?? []) handler(data); },
	};
}

const notification = (taskId: string, status: string) => ({ source: "subagent", taskId, status });
const launchStart = (callId: string, args: unknown) => ({ type: "tool_execution_start", toolCallId: callId, toolName: "subagent_run", args });
const launchEnd = (callId: string, result: unknown) => ({ type: "tool_execution_end", toolCallId: callId, toolName: "subagent_run", result, isError: false });

function enabledHost() {
	const root = mkdtempSync(join(tmpdir(), "gentle-office-wiring-"));
	const hub = new OfficeHub();
	const fake = fakeHost();
	registerOffice(fake.host as never, { agentDir: root, hub });
	fake.run("on");
	const cleanup = () => rmSync(root, { recursive: true, force: true });
	return { ...fake, hub, cleanup, agentsNow: () => hub.snapshot().agents };
}

describe("subagent identity reaches the hub through the Pi listeners", () => {
	it("a task-mode launch names the notification that follows it", () => {
		const h = enabledHost();
		try {
			h.emitPi("tool_execution_start", launchStart("call-1", { agent: "gentle-ai-explore", label: "map footer" }));
			h.emitChannel("gentle-pi:notification:source", notification("t-1", "running"));
			const [agent] = h.agentsNow();
			assert.equal(agent.id, "t-1");
			assert.equal(agent.agent, "gentle-ai-explore");
			assert.equal(agent.role, "explore");
			assert.equal(agent.label, "map footer");
		} finally {
			h.cleanup();
		}
	});

	it("a launch result that arrives after the notifications renames the agent in the hub", () => {
		const h = enabledHost();
		try {
			h.emitPi("tool_execution_start", launchStart("call-a", { agent: "gentle-ai-explore", label: "a" }));
			h.emitPi("tool_execution_start", launchStart("call-b", { agent: "gentle-ai-verify", label: "b" }));
			h.emitChannel("gentle-pi:notification:source", notification("t-2", "running"));
			h.emitChannel("gentle-pi:notification:source", notification("t-1", "running"));
			h.emitPi("tool_execution_end", launchEnd("call-b", { details: { gentleAgents: { taskId: "t-2" } } }));
			const byId = Object.fromEntries(h.agentsNow().map(agent => [agent.id, agent]));
			assert.equal(byId["t-2"].agent, "gentle-ai-verify");
			assert.equal(byId["t-2"].role, "verify");
		} finally {
			h.cleanup();
		}
	});

	it("an inspector launch is named as an inspector, so the room gives it no desk", () => {
		const h = enabledHost();
		try {
			h.emitPi("tool_execution_start", launchStart("call-r", { agent: "review-risk", label: "lens" }));
			h.emitChannel("gentle-pi:notification:source", notification("t-r", "running"));
			assert.equal(h.agentsNow()[0].role, "inspector");
		} finally {
			h.cleanup();
		}
	});

	it("other tools never touch the identity bridge", () => {
		const h = enabledHost();
		try {
			h.emitPi("tool_execution_start", { type: "tool_execution_start", toolCallId: "c", toolName: "bash", args: { agent: "gentle-ai-explore" } });
			h.emitChannel("gentle-pi:notification:source", notification("t-9", "running"));
			assert.equal(h.agentsNow()[0].agent, "unknown");
		} finally {
			h.cleanup();
		}
	});
});
