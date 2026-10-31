import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Image, allocateImageId, deleteKittyImage, getCapabilities, getCellDimensions, type OverlayHandle } from "@earendil-works/pi-tui";
import { OfficeHub } from "../src/adapter/hub.ts";
import { createOfficeServer } from "../src/server/office-server.ts";
import { openInBrowser } from "../src/server/open-browser.ts";
import { createAnimator, isActing } from "../src/stage/animator.ts";
import { chatLines, initialChat, reduceChat, type ChatState } from "../src/stage/chat.ts";
import { frameFromSnapshot, renderHqPng, type HqFrame } from "../src/stage/frame.ts";
import { composeGame, gameHud, gameLayout, gameSide } from "../src/stage/game.ts";
import { registerOffice, type TerminalStage } from "../src/toggle.ts";

// Thin wiring only. Event mapping, layout and state live in src/ so they stay testable.
// The window server is built here but binds nothing until `/office open`.
// Terminal mode (GENTLE_REEF=1, set by bin/gentle-reef) is read in src/toggle.ts. Nothing is persisted between sessions.
export default function gentleOffice(pi: ExtensionAPI): void {
	const hub = new OfficeHub();
	const server = createOfficeServer({
		hub,
		assetsDir: fileURLToPath(new URL("../web/", import.meta.url)),
		openUrl: url => openInBrowser(url),
	});
	const png = roomPng();
	const game = gameMode(hub, png);
	const controller = registerOffice(pi, { hub, server, stage: overlayStage(() => game.visible()) });
	if (!controller.terminal) return;

	// Game mode (T3): on by default in gentle-reef on Kitty terminals; alt+g goes back to plain Pi and forth.
	pi.on("session_start", (_event, ctx) => {
		try {
			if (kitty()) game.open(ctx);
		} catch {
			// Game mode is display only; plain Pi stays if it cannot open.
		}
		controller.refreshWidget();
	});
	// T4: the chat column reads Pi's own conversation events; alt+t shows or hides the orchestrator's thinking.
	for (const name of CHAT_EVENTS) pi.on(name, (event: { type: string }) => game.chat(event));
	pi.registerShortcut("alt+t", {
		description: "Gentle HQ: show or hide the orchestrator's thinking",
		handler: () => game.toggleThoughts(),
	});
	pi.registerShortcut("alt+g", {
		description: "Gentle HQ: switch between game mode and plain chat",
		handler: ctx => {
			if (kitty()) game.toggle(ctx);
			controller.refreshWidget();
		},
	});
}

const kitty = (): boolean => getCapabilities().images === "kitty";

/** Pi events the game mode chat shows (src/stage/chat.ts). */
const CHAT_EVENTS = ["input", "message_update", "message_end", "tool_execution_start", "tool_execution_end"] as const;

/** The room PNG for a frame, re-encoded only when what the room shows changes (a new animation step included). */
function roomPng(): (frame: HqFrame) => string {
	let last: { key: string; png: string } | undefined;
	return frame => {
		const key = JSON.stringify(frame);
		if (last?.key !== key) last = { key, png: renderHqPng(frame) };
		return last.png;
	};
}

/**
 * The terminal widget's stage hooks: game mode (below) shows the room, so the widget never draws the image itself.
 * While the overlay is up the widget is cleared (the HUD says it all); with alt+g back to plain chat it is the status line.
 */
function overlayStage(gameVisible: () => boolean): TerminalStage {
	return {
		available: () => false,
		covered: () => kitty() && gameVisible(),
		widget: () => () => ({ render: () => [], invalidate() {} }),
	};
}

/** Rows left under the overlay for Pi's editor, its frame and the status line. */
const EDITOR_ROWS = 8;

/**
 * Game mode (T3 spike): a full-width, non-capturing overlay over Pi's chat with the Gentle HQ layout (src/stage/game.ts):
 * HUD, the room on the left, the party and chat column on the right. The editor below keeps the focus.
 */
function gameMode(hub: OfficeHub, pngFor: (frame: HqFrame) => string) {
	let handle: OverlayHandle | undefined;
	let opening = false;
	let terminalRows = 40;
	let write: ((data: string) => void) | undefined;
	let animate: ((on: boolean) => void) | undefined;
	let repaint: (() => void) | undefined;
	let chat: ChatState = initialChat();
	let thoughtsShown = true;
	const imageId = allocateImageId();
	const project = process.cwd().replace(homedir(), "~");

	const open = (ctx: ExtensionContext): void => {
		if (handle || opening) return;
		opening = true;
		void ctx.ui.custom<void>(
			(tui, theme) => {
				terminalRows = tui.terminal.rows;
				write = data => tui.terminal.write(data);
				let image: { png: string; cols: number; rows: number; view: Image } | undefined;
				let lastWidth: number | undefined;
				// T7: the room moves at a low frame rate only while someone acts, and never while the overlay is hidden.
				const animator = createAnimator({ onTick: () => tui.requestRender() });
				const acting = (): boolean => isActing(frameFromSnapshot(hub.snapshot()));
				animate = on => animator.update(on && acting());
				repaint = () => tui.requestRender();
				const unsubscribe = hub.subscribe(() => {
					animator.update(!(handle?.isHidden() ?? false) && acting());
					tui.requestRender();
				});
				animator.update(acting());
				return {
					render(width: number): string[] {
						// After a resize Pi repaints only the lines that changed, which leaves the old chat showing through
						// around the overlay; one forced full repaint per new size clears it.
						if (terminalRows !== tui.terminal.rows || lastWidth !== width) {
							if (lastWidth !== undefined) queueMicrotask(() => tui.requestRender(true));
							lastWidth = width;
						}
						terminalRows = tui.terminal.rows;
						const layout = gameLayout(width, Math.max(1, terminalRows - EDITOR_ROWS), getCellDimensions());
						if (!layout) return [];
						const snapshot = hub.snapshot();
						const png = pngFor({ ...frameFromSnapshot(snapshot), motion: animator.running(), t: animator.step() });
						if (image?.png !== png || image.cols !== layout.roomCols || image.rows !== layout.bodyRows) {
							const view = new Image(png, "image/png", { fallbackColor: text => theme.fg("muted", text) }, { maxWidthCells: layout.roomCols, maxHeightCells: layout.bodyRows, imageId });
							image = { png, cols: layout.roomCols, rows: layout.bodyRows, view };
						}
						const side = gameSide(snapshot, chatLines(chat, { width: layout.sideCols, thoughtsShown }), layout.bodyRows);
						return composeGame(layout, { hud: gameHud(snapshot, { project }), room: image.view.render(layout.roomCols + 2), side });
					},
					invalidate() {
						image?.view.invalidate();
					},
					dispose() {
						repaint = undefined;
						animator.stop();
						unsubscribe();
					},
				};
			},
			{
				overlay: true,
				overlayOptions: () => ({ anchor: "top-left", width: "100%", maxHeight: Math.max(1, terminalRows - EDITOR_ROWS), margin: 0, nonCapturing: true }),
				onHandle: h => {
					handle = h;
					opening = false;
				},
			},
		)
			// Display only: a host that cannot show the overlay leaves plain Pi, never a broken session.
			.catch(() => undefined)
			.finally(() => {
				handle = undefined;
				opening = false;
			});
	};

	return {
		visible: () => (handle !== undefined && !handle.isHidden()) || opening,
		/** One Pi conversation event into the chat column; repaints only when it changed something. */
		chat(event: { type: string }): void {
			const next = reduceChat(chat, { ...event, at: Date.now() });
			if (next === chat) return;
			chat = next;
			repaint?.();
		},
		toggleThoughts(): void {
			thoughtsShown = !thoughtsShown;
			repaint?.();
		},
		open,
		toggle(ctx: ExtensionContext): void {
			if (!handle) return open(ctx);
			const hide = !handle.isHidden();
			handle.setHidden(hide);
			animate?.(!hide);
			// A Kitty image stays on screen until it is deleted; the overlay's lines going away does not remove it.
			if (hide) write?.(deleteKittyImage(imageId));
		},
	};
}
