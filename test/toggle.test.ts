import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficeHub } from "../src/adapter/hub.ts";
import { OFFICE_PI_EVENTS, registerOffice } from "../src/toggle.ts";
import { officeSettingsPath, readOfficeSettings } from "../src/settings.ts";

type Handler = (...args: any[]) => unknown;

// Fake Pi host: records every listener it is asked to attach, so tests can
// assert "no listeners when off" and "detached after /office off".
function fakeHost() {
	const piHandlers = new Map<string, Set<Handler>>();
	const channelHandlers = new Map<string, Set<Handler>>();
	const commands = new Map<string, { description: string; handler: Handler }>();
	const calls = { piOn: [] as string[], channelOn: [] as string[] };
	const add = (table: Map<string, Set<Handler>>, name: string, handler: Handler): (() => void) => {
		let set = table.get(name);
		if (!set) table.set(name, set = new Set());
		set.add(handler);
		return () => { table.get(name)?.delete(handler); };
	};
	const count = (table: Map<string, Set<Handler>>): number => [...table.values()].reduce((n, set) => n + set.size, 0);
	const host = {
		on(name: string, handler: Handler) { calls.piOn.push(name); return add(piHandlers, name, handler); },
		events: { on(channel: string, handler: Handler) { calls.channelOn.push(channel); return add(channelHandlers, channel, handler); } },
		registerCommand(name: string, options: { description: string; handler: Handler }) { commands.set(name, options); },
	};
	return {
		host,
		commands,
		calls,
		listeners: () => count(piHandlers) + count(channelHandlers),
		emitPi: (name: string, event: unknown, ctx?: unknown) => { for (const handler of piHandlers.get(name) ?? []) handler(event, ctx); },
		emitChannel: (channel: string, data: unknown) => { for (const handler of channelHandlers.get(channel) ?? []) handler(data); },
	};
}

let root: string;
before(() => { root = mkdtempSync(join(tmpdir(), "gentle-office-toggle-")); });
after(() => { rmSync(root, { recursive: true, force: true }); });

let agentDir: string;
let notes: { message: string; level: string }[];
const ctx = { ui: { notify: (message: string, level: string) => { notes.push({ message, level }); } } };
beforeEach(() => {
	agentDir = join(root, `agent-${Math.random().toString(36).slice(2)}`);
	mkdirSync(agentDir, { recursive: true });
	notes = [];
});

const run = (fake: ReturnType<typeof fakeHost>, args: string): void => {
	fake.commands.get("office")!.handler(args, ctx);
};

describe("registerOffice when the module is off", () => {
	it("registers only the /office command when the settings file is missing", () => {
		const fake = fakeHost();
		const hub = new OfficeHub();
		registerOffice(fake.host, { agentDir, hub });
		assert.deepEqual([...fake.commands.keys()], ["office"]);
		assert.deepEqual(fake.calls.piOn, []);
		assert.deepEqual(fake.calls.channelOn, []);
		assert.equal(fake.listeners(), 0);
	});

	it("stays off without throwing when the settings file is corrupt", () => {
		writeFileSync(officeSettingsPath(agentDir), "not json");
		const fake = fakeHost();
		assert.doesNotThrow(() => registerOffice(fake.host, { agentDir, hub: new OfficeHub() }));
		assert.equal(fake.listeners(), 0);
	});
});

describe("registerOffice when the module is on", () => {
	it("attaches the Pi and task-status listeners and feeds the hub", () => {
		writeFileSync(officeSettingsPath(agentDir), '{ "enabled": true }');
		const fake = fakeHost();
		const hub = new OfficeHub();
		registerOffice(fake.host, { agentDir, hub });

		assert.deepEqual(fake.calls.piOn, [...OFFICE_PI_EVENTS]);
		assert.deepEqual(fake.calls.channelOn, ["gentle-pi:notification:source"]);

		fake.emitPi("agent_start", { type: "agent_start" });
		assert.equal(hub.snapshot().orchestrator.state, "thinking");

		fake.emitPi("turn_end", { type: "turn_end" }, { getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 30 }) });
		assert.deepEqual(hub.snapshot().context, { percent: 30 });

		fake.emitChannel("gentle-pi:notification:source", { source: "subagent", taskId: "t1", status: "running", parentSessionId: "s1" });
		assert.equal(hub.snapshot().agents[0]?.id, "t1");
	});
});

describe("/office command", () => {
	it("on writes the setting, attaches listeners; off detaches them and clears the hub", () => {
		const fake = fakeHost();
		const hub = new OfficeHub();
		registerOffice(fake.host, { agentDir, hub });

		run(fake, "on");
		assert.equal(notes.at(-1)?.level, "info");
		assert.equal(readOfficeSettings(agentDir).enabled, true);
		assert.ok(fake.listeners() > 0);
		fake.emitPi("agent_start", { type: "agent_start" });
		assert.equal(hub.stats().published, 1);

		run(fake, "off");
		assert.equal(readOfficeSettings(agentDir).enabled, false);
		assert.equal(fake.listeners(), 0);
		assert.equal(hub.stats().buffered, 0);
		fake.emitPi("agent_start", { type: "agent_start" });
		assert.equal(hub.stats().published, 1);
	});

	it("status reports enabled state and hub stats", () => {
		const fake = fakeHost();
		const hub = new OfficeHub();
		registerOffice(fake.host, { agentDir, hub });
		run(fake, "status");
		assert.match(notes.at(-1)!.message, /disabled/);
		assert.match(notes.at(-1)!.message, /published 0/);

		run(fake, "on");
		run(fake, "status");
		assert.match(notes.at(-1)!.message, /enabled/);
	});

	it("unknown subcommands get usage and change nothing", () => {
		const fake = fakeHost();
		registerOffice(fake.host, { agentDir, hub: new OfficeHub() });
		run(fake, "maybe");
		assert.equal(notes.at(-1)?.level, "warning");
		assert.match(notes.at(-1)!.message, /Usage: \/office on \| off \| status/);
		assert.equal(readOfficeSettings(agentDir).enabled, false);
		assert.equal(fake.listeners(), 0);
	});

	it("a failed settings write reports the error and keeps listeners detached", () => {
		const blocker = join(root, `blocker-${Math.random().toString(36).slice(2)}`);
		writeFileSync(blocker, "a regular file");
		const fake = fakeHost();
		registerOffice(fake.host, { agentDir: join(blocker, "agent"), hub: new OfficeHub() });
		run(fake, "on");
		assert.equal(notes.at(-1)?.level, "error");
		assert.equal(fake.listeners(), 0);
	});
});
