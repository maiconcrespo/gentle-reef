import { piEventToOffice, type PiEvent, type UsageReading } from "./adapter/pi-events.ts";
import { GENTLE_NOTIFICATION_SOURCE_EVENT, subagentFromNotification } from "./adapter/task-status.ts";
import { SubagentIdentityBridge } from "./adapter/subagent-identity.ts";
import { OfficeHub, type HubStats, type OfficeSnapshot } from "./adapter/hub.ts";
import type { OfficeEvent } from "./contract/office-event.ts";
import type { OfficeServer } from "./server/office-server.ts";

export const OFFICE_COMMAND_NAME = "office";
const OFFICE_COMMAND_DESCRIPTION = "Open the Gentle Office menu, or run /office on | off | status | open | dock | story (this session only)";
/** Set by bin/gentle-reef. Read once, at load; a plain gentle-shell session leaves it unset. */
export const TERMINAL_MODE_ENV = "GENTLE_REEF";
const TERMINAL_MODE_AT_LOAD = process.env[TERMINAL_MODE_ENV] === "1";
/** Key of the terminal widget: the stage image when the terminal shows Kitty images, else one status line. */
export const REEF_WIDGET_KEY = "gentle-reef";
/** Query the window page reads to pick the compact (dock) layout. The token path is unchanged. */
const COMPACT_LAYOUT_QUERY = "layout=dock";
/** Query the window page reads to pick the story layout (close-up camera, dialog). The token path is unchanged. */
const STORY_LAYOUT_QUERY = "layout=story";
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

/** Task states that still count as an agent in flight on the widget. */
const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(["queued", "running", "waiting"]);

/** A Pi widget component factory, `(tui, theme) => Component`; kept structural so src/ never imports pi-tui. */
export type WidgetFactory = (tui: any, theme: any) => unknown;

interface WidgetUi {
	setWidget(key: string, content: string[] | WidgetFactory | undefined): void;
}

/**
 * The terminal stage (issue #1). Built in extensions/ with pi-tui; `available()` is false on terminals without
 * Kitty graphics, and the widget falls back to the one status line.
 */
export interface TerminalStage {
	available(): boolean;
	/** Game mode covers the screen with its own HUD: the widget is cleared instead of repeating it. */
	covered?(): boolean;
	widget(snapshot: OfficeSnapshot): WidgetFactory;
}

interface PiContext {
	readonly getContextUsage?: () => { readonly percent: number | null } | undefined;
	readonly ui?: WidgetUi;
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
	readonly server: OfficeWindow | undefined;
	/** Started by bin/gentle-reef: listeners attach at start and the status widget is drawn. */
	readonly terminal: boolean;
	isEnabled(): boolean;
	/** Affects this session only. Nothing is written to disk. */
	setEnabled(enabled: boolean): void;
	/** Redraws the terminal widget, e.g. after game mode (alt+g) changes whether the stage image is shown. */
	refreshWidget(): void;
}

function usageOf(ctx: PiContext | undefined): UsageReading | undefined {
	const usage = ctx?.getContextUsage?.();
	return usage === undefined ? undefined : { percent: usage.percent };
}

/** The terminal widget: one line with the orchestrator state and the agents still in flight. */
export function reefWidgetLine(snapshot: OfficeSnapshot): string {
	const agents = snapshot.agents.filter(agent => IN_FLIGHT_STATUSES.has(agent.status)).length;
	return `✿ gentle-reef · terminal mode · ${snapshot.orchestrator.state} · ${agents} agents`;
}

/**
 * Registers `/office` and, per session, attaches listeners while enabled. Plain
 * sessions start off and attach nothing until `/office on`. Terminal sessions
 * (GENTLE_REEF=1) start on and draw the status widget. No state is persisted.
 */
export function registerOffice(
	host: OfficeHost,
	options: { hub: OfficeHub; server?: OfficeWindow; terminal?: boolean; stage?: TerminalStage },
): OfficeController {
	const { hub, server, terminal = TERMINAL_MODE_AT_LOAD, stage } = options;
	const identity = new SubagentIdentityBridge();
	let enabled = false;
	let detachers: Array<() => void> = [];
	let widgetUi: WidgetUi | undefined;
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

	// The widget only exists in terminal mode and only once Pi has handed us the session's ui.
	// It is the stage image when the terminal shows Kitty images, else the one status line.
	const widgetContent = (): string[] | WidgetFactory | undefined => {
		if (!enabled || stage?.covered?.()) return undefined;
		const snapshot = hub.snapshot();
		return stage?.available() ? stage.widget(snapshot) : [reefWidgetLine(snapshot)];
	};
	const renderWidget = (): void => {
		if (!terminal || widgetUi === undefined) return;
		try {
			widgetUi.setWidget(REEF_WIDGET_KEY, widgetContent());
		} catch {
			// The widget is display only; a host that cannot draw it must not break a Pi event.
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
			hub.subscribe(() => renderWidget()),
		];
		renderWidget();
	};

	const detach = (): void => {
		if (!enabled) return;
		enabled = false;
		for (const off of detachers) off();
		detachers = [];
		stopWindow();
		identity.reset();
		hub.reset();
		renderWidget();
	};

	const controller: OfficeController = {
		hub,
		server,
		terminal,
		isEnabled: () => enabled,
		setEnabled(next) {
			if (next) attach();
			else detach();
		},
		refreshWidget: () => renderWidget(),
	};

	if (terminal) {
		host.on("session_start", (_event, ctx) => {
			widgetUi = ctx?.ui;
			renderWidget();
		});
		attach();
	}

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

/** `open`, `dock` and `story` are async (the server may need to start); everything else answers synchronously. */
function runSubcommand(subcommand: string, controller: OfficeController, ctx: OfficeCommandContext): Promise<void> | void {
	if (subcommand === "open") return openOffice(controller).then(result => ctx.ui.notify(result.message, result.level));
	if (subcommand === "dock") return openOffice(controller, COMPACT_LAYOUT_QUERY).then(result => ctx.ui.notify(result.message, result.level));
	if (subcommand === "story") return openOffice(controller, STORY_LAYOUT_QUERY).then(result => ctx.ui.notify(result.message, result.level));
	const result = runOfficeCommand(subcommand, controller);
	ctx.ui.notify(result.message, result.level);
}

/** Selector labels mapped to the subcommands they run, in display order, per module state. */
const MENU_WHEN_OFF: ReadonlyArray<readonly [string, readonly string[]]> = [
	["Turn on", ["on"]],
	["Turn on and open the window", ["on", "open"]],
	["Turn on and open the compact window", ["on", "dock"]],
	["Turn on and open in story mode", ["on", "story"]],
	["Status", ["status"]],
];
const MENU_WHEN_ON: ReadonlyArray<readonly [string, readonly string[]]> = [
	["Open the window", ["open"]],
	["Turn off", ["off"]],
	["Open the compact window", ["dock"]],
	["Open in story mode", ["story"]],
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
	if (!controller.isEnabled()) return { level: "warning", message: "Gentle Office is off for this session. Run /office on first." };
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
		controller.setEnabled(next);
		return { level: "info", message: next ? "Gentle Office on for this session: listeners attached." : "Gentle Office off for this session: listeners detached." };
	}
	if (subcommand === "" || subcommand === "status") {
		const state = controller.isEnabled() ? "enabled" : "disabled";
		const mode = controller.terminal ? " · terminal mode" : "";
		return { level: "info", message: `Gentle Office ${state} for this session${mode} · ${statsLine(controller.hub.stats())}${windowLine(controller.server)}` };
	}
	return { level: "warning", message: "Usage: /office on | off | status | open | dock | story" };
}
