import { piEventToOffice, type PiEvent, type UsageReading } from "./adapter/pi-events.ts";
import { GENTLE_NOTIFICATION_SOURCE_EVENT, subagentFromNotification } from "./adapter/task-status.ts";
import { SubagentIdentityBridge } from "./adapter/subagent-identity.ts";
import { OfficeHub, type HubStats } from "./adapter/hub.ts";
import type { OfficeEvent } from "./contract/office-event.ts";
import type { OfficeServer } from "./server/office-server.ts";
import { officeSettingsPath, readOfficeSettings, writeOfficeSettings } from "./settings.ts";

export const OFFICE_COMMAND_NAME = "office";
const OFFICE_COMMAND_DESCRIPTION = "Open the Gentle Office menu, or run /office on | off | status | open | dock";
/** Query the window page reads to pick the compact (dock) layout. The token path is unchanged. */
const COMPACT_LAYOUT_QUERY = "layout=dock";
/** Pi shuts the session down: the window server stops with it. Attached only while enabled. */
export const OFFICE_SHUTDOWN_EVENT = "session_shutdown";

/** Pi events the office renders. Attached only while the module is on. */
export const OFFICE_PI_EVENTS = [
	"agent_start",
	"turn_start",
	"turn_end",
	"agent_settled",
	"tool_execution_start",
	"tool_execution_end",
	"session_before_compact",
	"session_compact",
	"session_compact_failed",
] as const;

interface PiContext {
	readonly getContextUsage?: () => { readonly percent: number | null } | undefined;
}

export interface OfficeCommandContext {
	readonly ui: {
		notify(message: string, level?: "info" | "warning" | "error"): void;
		/** Interactive hosts only. Resolves to the picked option, or undefined when cancelled. */
		select?(title: string, options: string[]): Promise<string | undefined>;
	};
}

/**
 * Structural view of the Pi host. Pi's real `on()` is overloaded per event name;
 * the controller only needs this shape, which keeps it testable with a fake.
 */
export interface OfficeHost {
	// `any`: handler payloads differ per Pi event name.
	on(event: string, handler: (event: any, ctx?: PiContext) => unknown): () => void;
	readonly events: { on(channel: string, handler: (data: unknown) => void): () => void };
	registerCommand(name: string, options: { description: string; handler: (args: string, ctx: OfficeCommandContext) => unknown }): void;
}

/** The part of the window server the command needs. Optional: a host without one can still toggle the module. */
export type OfficeWindow = Pick<OfficeServer, "open" | "stop" | "status">;

export interface OfficeController {
	readonly hub: OfficeHub;
	readonly settingsPath: string;
	readonly server: OfficeWindow | undefined;
	isEnabled(): boolean;
	setEnabled(enabled: boolean): { ok: true } | { ok: false; error: string };
}

function usageOf(ctx: PiContext | undefined): UsageReading | undefined {
	const usage = ctx?.getContextUsage?.();
	return usage === undefined ? undefined : { percent: usage.percent };
}

/**
 * Registers `/office` and attaches listeners only while enabled. When off, the
 * only registration is the command. Reads the settings file once, here.
 */
export function registerOffice(host: OfficeHost, options: { agentDir: string; hub: OfficeHub; server?: OfficeWindow }): OfficeController {
	const { agentDir, hub, server } = options;
	const identity = new SubagentIdentityBridge();
	let enabled = false;
	let detachers: Array<() => void> = [];
	const stopWindow = (): void => {
		if (server) void server.stop().catch(() => undefined);
	};

	const publish = (events: readonly OfficeEvent[]): void => {
		try {
			for (const event of events) hub.publish(event);
		} catch {
			// Display state must never interrupt a Pi event.
		}
	};

	const attach = (): void => {
		if (enabled) return;
		enabled = true;
		detachers = [
			...OFFICE_PI_EVENTS.map(name =>
				host.on(name, (event: PiEvent, ctx?: PiContext) => {
					publish(piEventToOffice(event, usageOf(ctx)));
					// Launch input (agent, label) and launch result (task id) name the subagent notifications that follow.
					publish(identity.piEvent(event));
				}),
			),
			host.events.on(GENTLE_NOTIFICATION_SOURCE_EVENT, data => {
				const event = subagentFromNotification(data);
				if (event) publish([identity.observe(event)]);
			}),
			host.on(OFFICE_SHUTDOWN_EVENT, () => stopWindow()),
		];
	};

	const detach = (): void => {
		if (!enabled) return;
		enabled = false;
		for (const off of detachers) off();
		detachers = [];
		stopWindow();
		identity.reset();
		hub.reset();
	};

	const controller: OfficeController = {
		hub,
		server,
		settingsPath: officeSettingsPath(agentDir),
		isEnabled: () => enabled,
		setEnabled(next) {
			const written = writeOfficeSettings(agentDir, { enabled: next });
			if (!written.ok) return written;
			if (next) attach();
			else detach();
			return { ok: true };
		},
	};

	if (readOfficeSettings(agentDir).enabled) attach();

	host.registerCommand(OFFICE_COMMAND_NAME, {
		description: OFFICE_COMMAND_DESCRIPTION,
		handler: (args, ctx) => {
			const subcommand = args.trim().toLowerCase();
			// No arguments on an interactive host: let the user pick instead of typing a subcommand.
			if (subcommand === "" && ctx.ui.select) return selectOfficeAction(controller, ctx);
			return runSubcommand(subcommand, controller, ctx);
		},
	});
	return controller;
}

/** `open` and `dock` are async (the server may need to start); everything else answers synchronously. */
function runSubcommand(subcommand: string, controller: OfficeController, ctx: OfficeCommandContext): Promise<void> | void {
	if (subcommand === "open") return openOffice(controller).then(result => ctx.ui.notify(result.message, result.level));
	if (subcommand === "dock") return openOffice(controller, COMPACT_LAYOUT_QUERY).then(result => ctx.ui.notify(result.message, result.level));
	const result = runOfficeCommand(subcommand, controller);
	ctx.ui.notify(result.message, result.level);
}

/** Selector labels mapped to the subcommands they run, in display order, per module state. */
const MENU_WHEN_OFF: ReadonlyArray<readonly [string, readonly string[]]> = [
	["Turn on", ["on"]],
	["Turn on and open the window", ["on", "open"]],
	["Turn on and open the compact window", ["on", "dock"]],
	["Status", ["status"]],
];
const MENU_WHEN_ON: ReadonlyArray<readonly [string, readonly string[]]> = [
	["Open the window", ["open"]],
	["Turn off", ["off"]],
	["Open the compact window", ["dock"]],
	["Status", ["status"]],
];

async function selectOfficeAction(controller: OfficeController, ctx: OfficeCommandContext): Promise<void> {
	const enabled = controller.isEnabled();
	const menu = enabled ? MENU_WHEN_ON : MENU_WHEN_OFF;
	const picked = await ctx.ui.select!(`Gentle Office (${enabled ? "on" : "off"})`, menu.map(([label]) => label));
	const steps = menu.find(([label]) => label === picked)?.[1];
	if (steps === undefined) return;
	for (const step of steps) {
		await runSubcommand(step, controller, ctx);
		// Stop a chain when turning on failed: opening would only add a second, misleading error.
		if (step === "on" && !controller.isEnabled()) return;
	}
}

export interface OfficeCommandResult {
	readonly level: "info" | "warning" | "error";
	readonly message: string;
}

const statsLine = (stats: HubStats): string =>
	`subscribers ${stats.subscribers} · buffered ${stats.buffered} · published ${stats.published} · dropped ${stats.dropped}`;

const windowLine = (server: OfficeWindow | undefined): string => {
	if (server === undefined) return "";
	const status = server.status();
	return status.running && status.url !== undefined ? ` · window ${status.url} (${status.clients} connected)` : " · window closed";
};

/** `/office open` (and `/office dock` with the compact query): only while enabled. Starts the single window server if needed, then opens its URL. */
export async function openOffice(controller: OfficeController, query?: string): Promise<OfficeCommandResult> {
	if (!controller.isEnabled()) return { level: "warning", message: "Gentle Office is off. Run /office on first." };
	if (controller.server === undefined) return { level: "error", message: "Gentle Office window is not available in this host." };
	try {
		const result = await controller.server.open(query);
		if (!result.opened) return { level: "warning", message: `Gentle Office window: ${result.url} (no browser opened: ${result.error ?? "unknown error"}; open the URL by hand)` };
		return { level: "info", message: `Gentle Office window opened: ${result.url}` };
	} catch (error) {
		return { level: "error", message: `Gentle Office window could not start: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export function runOfficeCommand(args: string, controller: OfficeController): OfficeCommandResult {
	const subcommand = args.trim().toLowerCase();
	if (subcommand === "on" || subcommand === "off") {
		const next = subcommand === "on";
		const result = controller.setEnabled(next);
		if (!result.ok) return { level: "error", message: `Gentle Office: could not write ${controller.settingsPath}: ${result.error}` };
		return { level: "info", message: next ? "Gentle Office on: listeners attached." : "Gentle Office off: listeners detached." };
	}
	if (subcommand === "" || subcommand === "status") {
		const state = controller.isEnabled() ? "enabled" : "disabled";
		return { level: "info", message: `Gentle Office ${state} · ${statsLine(controller.hub.stats())}${windowLine(controller.server)}` };
	}
	return { level: "warning", message: "Usage: /office on | off | status | open | dock" };
}
