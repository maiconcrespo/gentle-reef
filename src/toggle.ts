import { piEventToOffice, type PiEvent, type UsageReading } from "./adapter/pi-events.ts";
import { GENTLE_NOTIFICATION_SOURCE_EVENT, subagentFromNotification } from "./adapter/task-status.ts";
import { OfficeHub, type HubStats } from "./adapter/hub.ts";
import type { OfficeEvent } from "./contract/office-event.ts";
import { officeSettingsPath, readOfficeSettings, writeOfficeSettings } from "./settings.ts";

export const OFFICE_COMMAND_NAME = "office";
const OFFICE_COMMAND_DESCRIPTION = "Turn the Gentle Office on, off, or show its status";

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
	readonly ui: { notify(message: string, level?: "info" | "warning" | "error"): void };
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

export interface OfficeController {
	readonly hub: OfficeHub;
	readonly settingsPath: string;
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
export function registerOffice(host: OfficeHost, options: { agentDir: string; hub: OfficeHub }): OfficeController {
	const { agentDir, hub } = options;
	let enabled = false;
	let detachers: Array<() => void> = [];

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
			...OFFICE_PI_EVENTS.map(name => host.on(name, (event: PiEvent, ctx?: PiContext) => publish(piEventToOffice(event, usageOf(ctx))))),
			host.events.on(GENTLE_NOTIFICATION_SOURCE_EVENT, data => {
				const event = subagentFromNotification(data);
				if (event) publish([event]);
			}),
		];
	};

	const detach = (): void => {
		if (!enabled) return;
		enabled = false;
		for (const off of detachers) off();
		detachers = [];
		hub.reset();
	};

	const controller: OfficeController = {
		hub,
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
			const result = runOfficeCommand(args, controller);
			ctx.ui.notify(result.message, result.level);
		},
	});
	return controller;
}

export interface OfficeCommandResult {
	readonly level: "info" | "warning" | "error";
	readonly message: string;
}

const statsLine = (stats: HubStats): string =>
	`subscribers ${stats.subscribers} · buffered ${stats.buffered} · published ${stats.published} · dropped ${stats.dropped}`;

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
		return { level: "info", message: `Gentle Office ${state} · ${statsLine(controller.hub.stats())}` };
	}
	return { level: "warning", message: "Usage: /office on | off | status" };
}
