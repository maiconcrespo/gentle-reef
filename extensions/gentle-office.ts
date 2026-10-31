import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown, allocateImageId, deleteKittyImage, getCapabilities, getCellDimensions, getPngDimensions, renderImage, type OverlayHandle } from "@earendil-works/pi-tui";
import { OfficeHub } from "../src/adapter/hub.ts";
import { createOfficeServer } from "../src/server/office-server.ts";
import { openInBrowser } from "../src/server/open-browser.ts";
import { createAnimator, isActing } from "../src/stage/animator.ts";
import { chatLines, currentReply, initialChat, reduceChat, type ChatState, type MarkdownRenderer } from "../src/stage/chat.ts";
import { frameFromSnapshot, renderHqPng, type HqFrame } from "../src/stage/frame.ts";
import { belowBackgrounds, composeGame, gameDialog, gameHud, gameLayout, gameSide } from "../src/stage/game.ts";
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

/**
 * The room as Kitty lines: the image on the first row (below cell backgrounds, so the dialog can cover part of it) and
 * one empty line per row it spans, as pi-tui's Image component returns them.
 */
function roomLines(png: string, cols: number, rows: number, imageId: number): string[] {
	const result = renderImage(png, getPngDimensions(png) ?? { widthPx: 1440, heightPx: 816 }, { maxWidthCells: cols, maxHeightCells: rows, imageId, moveCursor: false });
	if (!result) return [];
	return [belowBackgrounds(result.sequence), ...Array.from({ length: Math.max(0, result.rows - 1) }, () => "")];
}

/** Rows left under the overlay for Pi's editor and its frame, so the scene reaches it and Pi's chat never shows below. */
const EDITOR_ROWS = 4;

/**
 * Replies keep their formatting: pi-tui's Markdown with Pi's own theme, the same renderer as the plain chat. Parsing is
 * cached per text and width, since the column repaints on every streamed token.
 */
function markdownRenderer(): MarkdownRenderer {
	const cache = new Map<string, string[]>();
	return (text, width) => {
		const key = `${width}\u0000${text}`;
		let lines = cache.get(key);
		if (!lines) {
			try {
				lines = new Markdown(text, 0, 0, getMarkdownTheme()).render(width);
				while (lines.length > 1 && lines.at(-1)!.replace(/\x1b\[[0-9;]*m/g, "").trim() === "") lines.pop();
			} catch {
				lines = text.split("\n");
			}
			cache.set(key, lines);
			if (cache.size > 200) cache.delete(cache.keys().next().value!);
		}
		return lines;
	};
}

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
	const markdown = markdownRenderer();
	const imageId = allocateImageId();
	const project = process.cwd().replace(homedir(), "~");

	const open = (ctx: ExtensionContext): void => {
		if (handle || opening) return;
		opening = true;
		void ctx.ui.custom<void>(
			tui => {
				terminalRows = tui.terminal.rows;
				write = data => tui.terminal.write(data);
				let image: { png: string; cols: number; rows: number; lines: string[] } | undefined;
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
							image = { png, cols: layout.roomCols, rows: layout.bodyRows, lines: roomLines(png, layout.roomCols, layout.bodyRows, imageId) };
						}
						const lines = chatLines(chat, { width: layout.sideCols - 4, thoughtsShown, markdown });
						const side = gameSide(snapshot, lines, layout.bodyRows, layout.sideCols);
						// T4d: the current reply, or an open question, in a dialog over the bottom of the room.
						const reply = currentReply(chat);
						const question = snapshot.ask?.questions[0];
						const ask = question ? { question: question.question, options: question.options } : null;
						const dialogWidth = layout.roomCols - 4;
						const replyLines = reply ? markdown(reply, dialogWidth - 4) : [];
						const wanted = (ask ? ask.options.length + 1 : replyLines.length) + 2;
						const dialogHeight = Math.min(Math.max(4, Math.floor(layout.bodyRows * 0.35)), Math.max(3, wanted));
						const dialog = reply || ask ? gameDialog({ reply: replyLines, ask }, dialogWidth, dialogHeight) : undefined;
						return composeGame(layout, { hud: gameHud(snapshot, { project }), room: image.lines, side, dialog });
					},
					invalidate() {
						image = undefined;
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
