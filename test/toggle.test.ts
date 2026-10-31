import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { OfficeHub } from "../src/adapter/hub.ts";
import { createOfficeServer } from "../src/server/office-server.ts";

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

let notes: { message: string; level: string }[];
const ctx = { ui: { notify: (message: string, level: string) => { notes.push({ message, level }); } } };
beforeEach(() => {
	notes = [];
});

// Fake ui for the terminal widget: records every setWidget call.
function fakeUi() {
	// `content` is lines of text, a component factory (the terminal stage), or undefined to clear.
	const widgets: Array<{ key: string; content: any }> = [];
	return { widgets, ui: { setWidget(key: string, content: unknown) { widgets.push({ key, content }); } } };
}

// The module reads GENTLE_REEF once at load, so each mode gets its own fresh instance.
let loads = 0;
async function loadToggle(reef: "1" | undefined) {
	const previous = process.env.GENTLE_REEF;
	if (reef === undefined) delete process.env.GENTLE_REEF;
	else process.env.GENTLE_REEF = reef;
	try {
		return await import(`../src/toggle.ts?reef=${reef ?? "unset"}&load=${++loads}`);
	} finally {
		if (previous === undefined) delete process.env.GENTLE_REEF;
		else process.env.GENTLE_REEF = previous;
	}
}

// Plain mode, loaded explicitly: an inherited GENTLE_REEF=1 (for example, npm test from a gentle-reef shell) must not change these tests.
const { OFFICE_PI_EVENTS, registerOffice } = await loadToggle(undefined);

// Records every fs call that names gentle-office.json, so a test can prove on/off never touch it.
function spyOnSettingsFile(): { touched: string[]; restore(): void } {
	const touched: string[] = [];
	const names = ["readFileSync", "writeFileSync", "mkdirSync", "appendFileSync", "renameSync", "unlinkSync", "rmSync"] as const;
	const originals = new Map<string, (...args: any[]) => unknown>();
	for (const name of names) {
		const original = (fs as any)[name];
		originals.set(name, original);
		(fs as any)[name] = (...args: unknown[]) => {
			if (args.some(arg => String(arg).includes("gentle-office.json"))) touched.push(name);
			return original(...args);
		};
	}
	syncBuiltinESMExports();
	return {
		touched,
		restore() {
			for (const [name, original] of originals) (fs as any)[name] = original;
			syncBuiltinESMExports();
		},
	};
}

const run = (fake: ReturnType<typeof fakeHost>, args: string): void => {
	fake.commands.get("office")!.handler(args, ctx);
};

describe("registerOffice when the module is off", () => {
	it("registers only the /office command when the module is off", () => {
		const fake = fakeHost();
		const hub = new OfficeHub();
		registerOffice(fake.host, { hub });
		assert.deepEqual([...fake.commands.keys()], ["office"]);
		assert.deepEqual(fake.calls.piOn, []);
		assert.deepEqual(fake.calls.channelOn, []);
		assert.equal(fake.listeners(), 0);
	});

});

describe("registerOffice when the module is on", () => {
	it("attaches the Pi and task-status listeners and feeds the hub", () => {
		const fake = fakeHost();
		const hub = new OfficeHub();
		registerOffice(fake.host, { hub });
		run(fake, "on");

		assert.deepEqual(fake.calls.piOn, [...OFFICE_PI_EVENTS, "session_shutdown"]);
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
	it("on attaches listeners; off detaches them and clears the hub", () => {
		const fake = fakeHost();
		const hub = new OfficeHub();
		registerOffice(fake.host, { hub });

		run(fake, "on");
		assert.equal(notes.at(-1)?.level, "info");
		assert.equal(fake.listeners() > 0, true);
		assert.ok(fake.listeners() > 0);
		fake.emitPi("agent_start", { type: "agent_start" });
		assert.equal(hub.stats().published, 1);

		run(fake, "off");
		assert.equal(fake.listeners() > 0, false);
		assert.equal(fake.listeners(), 0);
		assert.equal(hub.stats().buffered, 0);
		fake.emitPi("agent_start", { type: "agent_start" });
		assert.equal(hub.stats().published, 1);
	});

	it("status reports enabled state and hub stats", () => {
		const fake = fakeHost();
		const hub = new OfficeHub();
		registerOffice(fake.host, { hub });
		run(fake, "status");
		assert.match(notes.at(-1)!.message, /disabled/);
		assert.match(notes.at(-1)!.message, /published 0/);

		run(fake, "on");
		run(fake, "status");
		assert.match(notes.at(-1)!.message, /enabled/);
	});

	it("unknown subcommands get usage and change nothing", () => {
		const fake = fakeHost();
		registerOffice(fake.host, { hub: new OfficeHub() });
		run(fake, "maybe");
		assert.equal(notes.at(-1)?.level, "warning");
		assert.match(notes.at(-1)!.message, /Usage: \/office on \| off \| status \| open/);
		assert.equal(fake.listeners() > 0, false);
		assert.equal(fake.listeners(), 0);
	});

});

describe("/office open and the window server", () => {
	const runAsync = async (fake: ReturnType<typeof fakeHost>, args: string): Promise<void> => {
		await fake.commands.get("office")!.handler(args, ctx);
	};
	// A real window server with a recording opener; each test stops what it started.
	function windowFixture() {
		const hub = new OfficeHub();
		const opened: string[] = [];
		const server = createOfficeServer({
			hub,
			openUrl: async (url: string) => { opened.push(url); return { opened: true }; },
		});
		return { hub, server, opened };
	}
	const openServers: Array<{ stop(): Promise<void> }> = [];
	afterEach(async () => {
		for (const server of openServers.splice(0)) await server.stop();
	});

	it("refuses while the module is off and starts nothing", async () => {
		const fake = fakeHost();
		const { hub, server, opened } = windowFixture();
		openServers.push(server);
		registerOffice(fake.host, { hub, server });
		await runAsync(fake, "open");
		assert.equal(notes.at(-1)?.level, "warning");
		assert.match(notes.at(-1)!.message, /\/office on/);
		assert.equal(server.status().running, false);
		assert.deepEqual(opened, []);
	});

	it("when on, starts one server, opens its URL and prints it; a second open reuses the server", async () => {
		const fake = fakeHost();
		const { hub, server, opened } = windowFixture();
		openServers.push(server);
		registerOffice(fake.host, { hub, server });
		run(fake, "on");
		await runAsync(fake, "open");
		const url = server.status().url;
		assert.ok(url, "the server must be running");
		assert.deepEqual(opened, [url]);
		assert.equal(notes.at(-1)?.level, "info");
		assert.ok(notes.at(-1)!.message.includes(url));
		await runAsync(fake, "open");
		assert.deepEqual(opened, [url, url]);
		assert.equal(server.status().url, url, "one instance per session");
	});

	it("an opener failure is reported with the URL, and the server keeps running", async () => {
		const fake = fakeHost();
		const hub = new OfficeHub();
		const server = createOfficeServer({ hub, openUrl: async () => ({ opened: false, error: "no xdg-open" }) });
		openServers.push(server);
		registerOffice(fake.host, { hub, server });
		run(fake, "on");
		await runAsync(fake, "open");
		assert.equal(notes.at(-1)?.level, "warning");
		assert.match(notes.at(-1)!.message, /no xdg-open/);
		assert.ok(notes.at(-1)!.message.includes(server.status().url!));
		assert.equal(server.status().running, true);
	});

	it("off stops the window server and its clients at once", async () => {
		const fake = fakeHost();
		const { hub, server } = windowFixture();
		openServers.push(server);
		registerOffice(fake.host, { hub, server });
		run(fake, "on");
		await runAsync(fake, "open");
		assert.equal(server.status().running, true);
		run(fake, "off");
		assert.equal(server.status().running, false);
		assert.equal(hub.stats().subscribers, 0);
	});

	it("session_shutdown stops the window server", async () => {
		const fake = fakeHost();
		const { hub, server } = windowFixture();
		openServers.push(server);
		registerOffice(fake.host, { hub, server });
		run(fake, "on");
		await runAsync(fake, "open");
		fake.emitPi("session_shutdown", { type: "session_shutdown", reason: "quit" });
		assert.equal(server.status().running, false);
	});

	it("status shows the window URL and its connected clients while it runs", async () => {
		const fake = fakeHost();
		const { hub, server } = windowFixture();
		openServers.push(server);
		registerOffice(fake.host, { hub, server });
		run(fake, "on");
		run(fake, "status");
		assert.match(notes.at(-1)!.message, /window closed/);
		await runAsync(fake, "open");
		run(fake, "status");
		assert.match(notes.at(-1)!.message, new RegExp(`window ${server.status().url!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} \\(0 connected\\)`));
	});
});

describe("/office with no arguments opens a selector", () => {
	// A ctx with a scripted select: records each prompt and answers with the given choice.
	function selectCtx(answer: string | undefined) {
		const prompts: { title: string; options: string[] }[] = [];
		return {
			prompts,
			ctx: {
				ui: {
					notify: (message: string, level: string) => { notes.push({ message, level }); },
					select: async (title: string, options: string[]) => { prompts.push({ title, options }); return answer; },
				},
			},
		};
	}
	const openServers: Array<{ stop(): Promise<void> }> = [];
	afterEach(async () => {
		for (const server of openServers.splice(0)) await server.stop();
	});

	it("while off, offers turn on, turn on and open, and status; picking Turn on enables the module", async () => {
		const fake = fakeHost();
		registerOffice(fake.host, { hub: new OfficeHub() });
		const { prompts, ctx: selCtx } = selectCtx("Turn on");
		await fake.commands.get("office")!.handler("", selCtx);
		assert.deepEqual(prompts, [{ title: "Gentle Office (off)", options: ["Turn on", "Turn on and open the window", "Turn on and open the compact window", "Turn on and open in story mode", "Status"] }]);
		assert.equal(fake.listeners() > 0, true);
		assert.ok(fake.listeners() > 0);
		assert.deepEqual(notes.at(-1), { message: "Gentle Office on for this session: listeners attached.", level: "info" });
	});

	it("while on, offers open, turn off, and status; picking Turn off disables the module", async () => {
		const fake = fakeHost();
		registerOffice(fake.host, { hub: new OfficeHub() });
		run(fake, "on");
		const { prompts, ctx: selCtx } = selectCtx("Turn off");
		await fake.commands.get("office")!.handler("  ", selCtx);
		assert.deepEqual(prompts, [{ title: "Gentle Office (on)", options: ["Open the window", "Turn off", "Open the compact window", "Open in story mode", "Status"] }]);
		assert.equal(fake.listeners() > 0, false);
		assert.equal(fake.listeners(), 0);
		assert.deepEqual(notes.at(-1), { message: "Gentle Office off for this session: listeners detached.", level: "info" });
	});

	it("Turn on and open the window enables the module and opens one window", async () => {
		const fake = fakeHost();
		const hub = new OfficeHub();
		const opened: string[] = [];
		const server = createOfficeServer({ hub, openUrl: async (url: string) => { opened.push(url); return { opened: true }; } });
		openServers.push(server);
		registerOffice(fake.host, { hub, server });
		const { ctx: selCtx } = selectCtx("Turn on and open the window");
		await fake.commands.get("office")!.handler("", selCtx);
		assert.equal(fake.listeners() > 0, true);
		assert.deepEqual(opened, [server.status().url]);
		assert.deepEqual(notes.map(n => n.level), ["info", "info"]);
		assert.equal(notes.at(-1)!.message, `Gentle Office window opened: ${server.status().url}`);
	});

	it("Status reports the same line as /office status", async () => {
		const fake = fakeHost();
		registerOffice(fake.host, { hub: new OfficeHub() });
		const { ctx: selCtx } = selectCtx("Status");
		await fake.commands.get("office")!.handler("", selCtx);
		const fromSelector = notes.splice(0);
		run(fake, "status");
		assert.deepEqual(fromSelector, notes);
	});

	it("cancelling the selector changes nothing and prints nothing", async () => {
		const fake = fakeHost();
		registerOffice(fake.host, { hub: new OfficeHub() });
		const { prompts, ctx: selCtx } = selectCtx(undefined);
		await fake.commands.get("office")!.handler("", selCtx);
		assert.equal(prompts.length, 1);
		assert.deepEqual(notes, []);
		assert.equal(fake.listeners() > 0, false);
		assert.equal(fake.listeners(), 0);
	});

	it("a host without a selector still answers /office with the status line", () => {
		const fake = fakeHost();
		registerOffice(fake.host, { hub: new OfficeHub() });
		run(fake, "");
		assert.equal(notes.length, 1);
		assert.match(notes[0]!.message, /^Gentle Office disabled for this session · subscribers 0/);
	});

	it("typed subcommands skip the selector", async () => {
		const fake = fakeHost();
		registerOffice(fake.host, { hub: new OfficeHub() });
		const { prompts, ctx: selCtx } = selectCtx("Turn off");
		await fake.commands.get("office")!.handler("on", selCtx);
		assert.deepEqual(prompts, []);
		assert.equal(fake.listeners() > 0, true);
	});
});

describe("/office dock and the compact window", () => {
	const openServers: Array<{ stop(): Promise<void> }> = [];
	afterEach(async () => {
		for (const server of openServers.splice(0)) await server.stop();
	});
	// Real window server with a recording opener; the compact entries must open the same tokened URL plus ?layout=dock.
	function dockFixture(fake: ReturnType<typeof fakeHost>) {
		const hub = new OfficeHub();
		const opened: string[] = [];
		const server = createOfficeServer({ hub, openUrl: async (url: string) => { opened.push(url); return { opened: true }; } });
		openServers.push(server);
		registerOffice(fake.host, { hub, server });
		return { server, opened };
	}
	const pick = (answer: string | undefined) => {
		const prompts: { title: string; options: string[] }[] = [];
		const selectCtx = {
			prompts,
			ctx: {
				ui: {
					notify: (message: string, level: string) => { notes.push({ message, level }); },
					select: async (title: string, options: string[]) => { prompts.push({ title, options }); return answer; },
				},
			},
		};
		return selectCtx;
	};

	it("/office dock while off refuses like open and starts nothing", async () => {
		const fake = fakeHost();
		const { server, opened } = dockFixture(fake);
		await fake.commands.get("office")!.handler("open", ctx);
		const fromOpen = notes.splice(0);
		await fake.commands.get("office")!.handler("dock", ctx);
		assert.deepEqual(notes, fromOpen);
		assert.equal(notes.at(-1)?.level, "warning");
		assert.equal(server.status().running, false);
		assert.deepEqual(opened, []);
	});

	it("/office dock while on opens one window at the tokened URL with ?layout=dock", async () => {
		const fake = fakeHost();
		const { server, opened } = dockFixture(fake);
		run(fake, "on");
		await fake.commands.get("office")!.handler("dock", ctx);
		const url = server.status().url!;
		assert.deepEqual(opened, [`${url}?layout=dock`]);
		assert.deepEqual(notes.at(-1), { message: `Gentle Office window opened: ${url}?layout=dock`, level: "info" });
	});

	it("Open the compact window opens one ?layout=dock URL while on", async () => {
		const fake = fakeHost();
		const { server, opened } = dockFixture(fake);
		run(fake, "on");
		const { prompts, ctx: selCtx } = pick("Open the compact window");
		await fake.commands.get("office")!.handler("", selCtx);
		assert.deepEqual(prompts, [{ title: "Gentle Office (on)", options: ["Open the window", "Turn off", "Open the compact window", "Open in story mode", "Status"] }]);
		assert.deepEqual(opened, [`${server.status().url}?layout=dock`]);
	});

	it("Turn on and open the compact window enables the module and opens one ?layout=dock URL", async () => {
		const fake = fakeHost();
		const { server, opened } = dockFixture(fake);
		const { prompts, ctx: selCtx } = pick("Turn on and open the compact window");
		await fake.commands.get("office")!.handler("", selCtx);
		assert.deepEqual(prompts, [{ title: "Gentle Office (off)", options: ["Turn on", "Turn on and open the window", "Turn on and open the compact window", "Turn on and open in story mode", "Status"] }]);
		assert.equal(fake.listeners() > 0, true);
		assert.deepEqual(opened, [`${server.status().url}?layout=dock`]);
		assert.deepEqual(notes.map(n => n.level), ["info", "info"]);
	});

	it("the usage line lists dock next to open", () => {
		const fake = fakeHost();
		registerOffice(fake.host, { hub: new OfficeHub() });
		run(fake, "maybe");
		assert.match(notes.at(-1)!.message, /Usage: \/office on \| off \| status \| open \| dock/);
	});
});

describe("/office story and the story layout", () => {
	const openServers: Array<{ stop(): Promise<void> }> = [];
	afterEach(async () => {
		for (const server of openServers.splice(0)) await server.stop();
	});
	// Real window server with a recording opener; the story entries must open the same tokened URL plus ?layout=story.
	function storyFixture(fake: ReturnType<typeof fakeHost>) {
		const hub = new OfficeHub();
		const opened: string[] = [];
		const server = createOfficeServer({ hub, openUrl: async (url: string) => { opened.push(url); return { opened: true }; } });
		openServers.push(server);
		registerOffice(fake.host, { hub, server });
		return { server, opened };
	}
	const pick = (answer: string | undefined) => {
		const prompts: { title: string; options: string[] }[] = [];
		const selectCtx = {
			prompts,
			ctx: {
				ui: {
					notify: (message: string, level: string) => { notes.push({ message, level }); },
					select: async (title: string, options: string[]) => { prompts.push({ title, options }); return answer; },
				},
			},
		};
		return selectCtx;
	};

	it("/office story while off refuses like open and starts nothing", async () => {
		const fake = fakeHost();
		const { server, opened } = storyFixture(fake);
		await fake.commands.get("office")!.handler("open", ctx);
		const fromOpen = notes.splice(0);
		await fake.commands.get("office")!.handler("story", ctx);
		assert.deepEqual(notes, fromOpen);
		assert.equal(notes.at(-1)?.level, "warning");
		assert.equal(server.status().running, false);
		assert.deepEqual(opened, []);
	});

	it("/office story while on opens one window at the tokened URL with ?layout=story", async () => {
		const fake = fakeHost();
		const { server, opened } = storyFixture(fake);
		run(fake, "on");
		await fake.commands.get("office")!.handler("story", ctx);
		const url = server.status().url!;
		assert.deepEqual(opened, [`${url}?layout=story`]);
		assert.deepEqual(notes.at(-1), { message: `Gentle Office window opened: ${url}?layout=story`, level: "info" });
	});

	it("Open in story mode opens one ?layout=story URL while on", async () => {
		const fake = fakeHost();
		const { server, opened } = storyFixture(fake);
		run(fake, "on");
		const { prompts, ctx: selCtx } = pick("Open in story mode");
		await fake.commands.get("office")!.handler("", selCtx);
		assert.deepEqual(prompts, [{ title: "Gentle Office (on)", options: ["Open the window", "Turn off", "Open the compact window", "Open in story mode", "Status"] }]);
		assert.deepEqual(opened, [`${server.status().url}?layout=story`]);
	});

	it("Turn on and open in story mode enables the module and opens one ?layout=story URL", async () => {
		const fake = fakeHost();
		const { server, opened } = storyFixture(fake);
		const { prompts, ctx: selCtx } = pick("Turn on and open in story mode");
		await fake.commands.get("office")!.handler("", selCtx);
		assert.deepEqual(prompts, [{ title: "Gentle Office (off)", options: ["Turn on", "Turn on and open the window", "Turn on and open the compact window", "Turn on and open in story mode", "Status"] }]);
		assert.equal(fake.listeners() > 0, true);
		assert.deepEqual(opened, [`${server.status().url}?layout=story`]);
		assert.deepEqual(notes.map(n => n.level), ["info", "info"]);
	});
});

describe("per-session state and the settings file", () => {
	it("on and off never read or write gentle-office.json", () => {
		const spy = spyOnSettingsFile();
		try {
			const fake = fakeHost();
			registerOffice(fake.host, { hub: new OfficeHub() });
			run(fake, "on");
			run(fake, "off");
			run(fake, "on");
		} finally {
			spy.restore();
		}
		assert.deepEqual(spy.touched, []);
	});

	it("a fresh session starts off after /office on in another one", () => {
		const first = fakeHost();
		registerOffice(first.host, { hub: new OfficeHub() });
		run(first, "on");
		assert.ok(first.listeners() > 0);

		const second = fakeHost();
		const controller = registerOffice(second.host, { hub: new OfficeHub() });
		assert.equal(controller.isEnabled(), false);
		assert.equal(second.listeners(), 0);
		assert.deepEqual(second.calls.piOn, []);
	});

	it("the command description says the menu and subcommands apply to this session", () => {
		const fake = fakeHost();
		registerOffice(fake.host, { hub: new OfficeHub() });
		assert.match(fake.commands.get("office")!.description, /this session/);
	});

	it("plain mode never sets a widget, even after /office on", () => {
		const fake = fakeHost();
		const { widgets, ui } = fakeUi();
		registerOffice(fake.host, { hub: new OfficeHub() });
		assert.ok(!fake.calls.piOn.includes("session_start"));
		fake.emitPi("session_start", { type: "session_start" }, { ui });
		run(fake, "on");
		run(fake, "off");
		assert.deepEqual(widgets, []);
	});
});

describe("terminal mode (GENTLE_REEF=1)", () => {
	it("attaches the listeners at start, before any /office command", async () => {
		const toggle = await loadToggle("1");
		const fake = fakeHost();
		const hub = new OfficeHub();
		toggle.registerOffice(fake.host, { hub });
		for (const name of OFFICE_PI_EVENTS) assert.ok(fake.calls.piOn.includes(name), name);
		assert.deepEqual(fake.calls.channelOn, ["gentle-pi:notification:source"]);
		fake.emitPi("agent_start", { type: "agent_start" });
		assert.equal(hub.stats().published, 1);
	});

	it("sets the one-line widget once the session starts, and keeps it current from hub events", async () => {
		const toggle = await loadToggle("1");
		const fake = fakeHost();
		const { widgets, ui } = fakeUi();
		toggle.registerOffice(fake.host, { hub: new OfficeHub() });
		assert.deepEqual(widgets, [], "no ui before session_start");

		fake.emitPi("session_start", { type: "session_start" }, { ui });
		assert.deepEqual(widgets.at(-1), { key: "gentle-reef", content: ["✿ gentle-reef · terminal mode · idle · 0 agents"] });

		fake.emitPi("agent_start", { type: "agent_start" });
		assert.equal(widgets.at(-1)?.content?.[0], "✿ gentle-reef · terminal mode · thinking · 0 agents");

		fake.emitChannel("gentle-pi:notification:source", { source: "subagent", taskId: "t1", status: "running", parentSessionId: "s1" });
		assert.equal(widgets.at(-1)?.content?.[0], "✿ gentle-reef · terminal mode · thinking · 1 agents");

		fake.emitChannel("gentle-pi:notification:source", { source: "subagent", taskId: "t1", status: "completed", parentSessionId: "s1" });
		assert.equal(widgets.at(-1)?.content?.[0], "✿ gentle-reef · terminal mode · thinking · 0 agents");
	});

	it("draws the stage when the terminal shows Kitty images, and keeps the one-line widget when it does not (#1)", async () => {
		const toggle = await loadToggle("1");
		let kitty = true;
		const seen: unknown[] = [];
		const stage = {
			available: () => kitty,
			widget: (snapshot: unknown) => {
				seen.push(snapshot);
				return () => ({ render: () => ["stage"], invalidate() {} });
			},
		};
		const fake = fakeHost();
		const { widgets, ui } = fakeUi();
		toggle.registerOffice(fake.host, { hub: new OfficeHub(), stage });
		fake.emitPi("session_start", { type: "session_start" }, { ui });
		assert.equal(widgets.at(-1)?.key, "gentle-reef");
		assert.equal(typeof widgets.at(-1)?.content, "function", "a component factory, not text");
		assert.equal(seen.length, 1, "the stage gets the hub snapshot");

		kitty = false;
		fake.emitPi("agent_start", { type: "agent_start" });
		assert.deepEqual(widgets.at(-1), { key: "gentle-reef", content: ["✿ gentle-reef · terminal mode · thinking · 0 agents"] });

		run(fake, "off");
		assert.deepEqual(widgets.at(-1), { key: "gentle-reef", content: undefined });
	});

	it("refreshWidget redraws with the stage's current availability (alt+g game mode hides the stage image)", async () => {
		const toggle = await loadToggle("1");
		let kitty = true;
		const stage = { available: () => kitty, widget: () => () => ({ render: () => [], invalidate() {} }) };
		const fake = fakeHost();
		const { widgets, ui } = fakeUi();
		const controller = toggle.registerOffice(fake.host, { hub: new OfficeHub(), stage });
		fake.emitPi("session_start", { type: "session_start" }, { ui });
		assert.equal(typeof widgets.at(-1)?.content, "function");
		kitty = false;
		controller.refreshWidget();
		assert.deepEqual(widgets.at(-1), { key: "gentle-reef", content: ["✿ gentle-reef · terminal mode · idle · 0 agents"] });
	});

	it("while game mode covers the screen the widget is cleared, so the status line does not repeat the HUD", async () => {
		const toggle = await loadToggle("1");
		let covered = true;
		const stage = { available: () => false, covered: () => covered, widget: () => () => ({ render: () => [], invalidate() {} }) };
		const fake = fakeHost();
		const { widgets, ui } = fakeUi();
		const controller = toggle.registerOffice(fake.host, { hub: new OfficeHub(), stage });
		fake.emitPi("session_start", { type: "session_start" }, { ui });
		assert.deepEqual(widgets.at(-1), { key: "gentle-reef", content: undefined });
		covered = false;
		controller.refreshWidget();
		assert.deepEqual(widgets.at(-1), { key: "gentle-reef", content: ["✿ gentle-reef · terminal mode · idle · 0 agents"] });
	});

	it("/office off detaches this session's listeners and clears the widget; /office on brings both back", async () => {
		const toggle = await loadToggle("1");
		const fake = fakeHost();
		const hub = new OfficeHub();
		const { widgets, ui } = fakeUi();
		toggle.registerOffice(fake.host, { hub });
		fake.emitPi("session_start", { type: "session_start" }, { ui });

		run(fake, "off");
		assert.deepEqual(widgets.at(-1), { key: "gentle-reef", content: undefined });
		assert.equal(hub.stats().subscribers, 0);
		const before = hub.stats().published;
		fake.emitPi("agent_start", { type: "agent_start" });
		assert.equal(hub.stats().published, before);

		run(fake, "on");
		assert.equal(widgets.at(-1)?.content?.[0], "✿ gentle-reef · terminal mode · idle · 0 agents");
		fake.emitPi("agent_start", { type: "agent_start" });
		assert.equal(hub.stats().published, before + 1);
	});

	it("a widget that throws does not break the Pi event that triggered the update", async () => {
		const toggle = await loadToggle("1");
		const fake = fakeHost();
		const hub = new OfficeHub();
		toggle.registerOffice(fake.host, { hub });
		const broken = { setWidget() { throw new Error("tui gone"); } };
		fake.emitPi("session_start", { type: "session_start" }, { ui: broken });
		assert.doesNotThrow(() => fake.emitPi("agent_start", { type: "agent_start" }));
		assert.equal(hub.stats().published, 1);
	});
});
