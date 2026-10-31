import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown, allocateImageId, deleteKittyImage, getCapabilities, getCellDimensions, getPngDimensions, isKeyRelease, matchesKey, renderImage, type OverlayHandle } from "@earendil-works/pi-tui";
import { OfficeHub } from "../src/adapter/hub.ts";
import { createOfficeServer } from "../src/server/office-server.ts";
import { openInBrowser } from "../src/server/open-browser.ts";
import { createAnimator, isActing } from "../src/stage/animator.ts";
import { chatLines, currentReply, initialChat, jobsFromChat, reduceChat, type ChatState, type MarkdownRenderer } from "../src/stage/chat.ts";
import { frameFromSnapshot, renderHqPng, renderPortraitPng, type HqFrame } from "../src/stage/frame.ts";
import { createChoiceSelector, type ChoiceSelector, type SelectorKey } from "../src/stage/selector.ts";
import { NOTICE_MS, currentNotice, wrapNotify, type Notice } from "../src/stage/notice.ts";
import { boardRows, doingNow, todoFromEntries, todoFromToolEnd, type TodoTask } from "../src/stage/todo.ts";
import { PORTRAIT_COLS, ROOM_Z, aboveBackgrounds, composeGame, nextRoomId, splitKitty, gameDialog, scrollDialog, type DialogScrollKey, portraitFits, gameLayout, gameSide, hiddenPanel, rowsBelow, sceneSigns, todoSigns } from "../src/stage/game.ts";
import { lastResult } from "../src/stage/memo.ts";
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
			// T4b: a resumed session shows its todo list from the start, not after the next todo call.
			game.restoreTodo(todoFromEntries(ctx.sessionManager?.getBranch?.() ?? []));
			// T4b: warnings from any extension (ui.notify) also show in a box in the scene; Pi still shows them as before.
			wrapNotify(ctx.ui, notice => game.notice(notice));
			if (kitty()) game.open(ctx);
		} catch {
			// Game mode is display only; plain Pi stays if it cannot open.
		}
		controller.refreshWidget();
	});
	// T4: the chat column reads Pi's own conversation events; alt+t shows or hides the orchestrator's thinking.
	for (const name of CHAT_EVENTS) pi.on(name, (event: { type: string }) => game.chat(event));
	// Pi's own prompts (select, confirm, input, editor) need room below the overlay. Our overlay is a ui.custom, so
	// "custom" prompts are not counted: the scene must not shrink because of itself.
	pi.on("ui_prompt_start", (event: { kind?: string }) => { if (event.kind !== "custom") game.prompt(+1); });
	pi.on("ui_prompt_end", (event: { kind?: string }) => { if (event.kind !== "custom") game.prompt(-1); });
	pi.registerShortcut("alt+t", {
		description: "Gentle HQ: show or hide the orchestrator's thinking",
		handler: () => game.toggleThoughts(),
	});
	pi.registerShortcut("alt+c", {
		description: "Gentle HQ: show or hide the side panel (PARTY, notices and CHAT); the room is centred without it",
		handler: () => game.togglePanel(),
	});
	pi.registerShortcut("alt+g", {
		description: "Gentle HQ: switch between game mode and plain chat",
		handler: ctx => {
			if (kitty()) game.toggle(ctx);
			controller.refreshWidget();
		},
	});
}

/** The dialog's scroll keys (T9): PgUp/PgDn move a page, shift+up/down a line. */
function dialogScrollKey(data: string): DialogScrollKey | undefined {
	if (matchesKey(data, "pageUp")) return "page-up";
	if (matchesKey(data, "pageDown")) return "page-down";
	if (matchesKey(data, "shift+up")) return "line-up";
	if (matchesKey(data, "shift+down")) return "line-down";
	return undefined;
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

/** The room image's lines and the cells it actually covers (signs are placed on that grid). */
interface RoomImage {
	readonly lines: string[];
	readonly cols: number;
	readonly rows: number;
	/** The image data for the terminal, written once when the PNG changes (T10); empty without Kitty. */
	readonly transmit: string;
}

/**
 * The room as Kitty lines: a placement on the first row (below cell backgrounds, so the dialog and the signs can cover
 * parts of it) and one empty line per row it spans. The data travels apart, in `transmit` (splitKitty).
 */
function roomImage(png: string, cols: number, rows: number, imageId: number): RoomImage {
	const result = renderImage(png, getPngDimensions(png) ?? { widthPx: 1440, heightPx: 816 }, { maxWidthCells: cols, maxHeightCells: rows, imageId, moveCursor: false });
	if (!result) return { lines: [], cols, rows, transmit: "" };
	const { transmit, place } = splitKitty(result.sequence, { imageId, columns: result.columns, rows: result.rows, z: ROOM_Z });
	return { lines: [place, ...Array.from({ length: Math.max(0, result.rows - 1) }, () => "")], cols: result.columns, rows: result.rows, transmit };
}

/** The current git branch for the project sign, read at most every 5 s; null outside a repository. */
function branchReader(cwd: string): () => string | null {
	let at = 0, value: string | null = null;
	return () => {
		const now = Date.now();
		if (now - at < 5000) return value;
		at = now;
		try {
			const name = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 500, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
			value = name && name !== "HEAD" ? name : null;
		} catch {
			value = null;
		}
		return value;
	};
}

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
	let todo: readonly TodoTask[] = [];
	let notice: Notice | null = null;
	let thoughtsShown = true;
	let panelShown = true;
	// T9: the reply's first line shown in the dialog (null follows the tail) and the size of the last reply dialog drawn.
	let dialogTop: number | null = null;
	let dialogView: { total: number; rows: number } | undefined;
	let prompts = 0;
	let forceRepaint: (() => void) | undefined;
	// T4e: the dialog is the selector for a single-select question. `editing` is Pi's "Other…" editor after it.
	let selector: { question: string; choice: ChoiceSelector } | undefined;
	let editing = false;
	/** Rows under the overlay: the editor while the dialog drives the answer, else room for Pi's selector or editor (rowsBelow). */
	const reserved = (): number => {
		if (selector?.choice.active()) return rowsBelow({ askOptions: null, prompts: 0 });
		return rowsBelow({ askOptions: editing ? null : hub.snapshot().ask?.questions[0]?.options.length ?? null, prompts: prompts + (editing ? 1 : 0) });
	};
	/** A single-select question the dialog can drive; multi-question and multi-select asks keep Pi's selector. */
	const syncSelector = (canReplay: boolean): void => {
		const questions = hub.snapshot().ask?.questions ?? [];
		const only = questions.length === 1 && !questions[0]!.multiSelect && questions[0]!.options.length > 0 ? questions[0]! : undefined;
		if (!only || !canReplay) {
			selector = undefined;
			if (!questions.length) editing = false;
			return;
		}
		if (selector?.question !== only.question) {
			selector = { question: only.question, choice: createChoiceSelector({ options: only.options.length, custom: only.custom === true }) };
			editing = false;
		}
	};
	const markdown = markdownRenderer();
	// L29: two ids in turn for the room, so a new frame is placed before the old one is deleted (no blank frame).
	const roomIds = [allocateImageId(), allocateImageId()] as const;
	let shownRoom: number | undefined;
	// T4b: the orchestrator's portrait in the dialog, a second Kitty image drawn over the dialog's panel.
	const portraitId = allocateImageId();
	const portraitPng = renderPortraitPng();
	let portrait: { rows: number; image: string } | undefined;
	let portraitShown = false;
	// T10: hiding game mode frees the room's image data in the terminal; the next render sends it again.
	let resendRoom = false;
	const portraitFor = (rows: number): string => {
		if (portrait?.rows !== rows) {
			const result = renderImage(portraitPng, { widthPx: 96, heightPx: 96 }, { maxWidthCells: PORTRAIT_COLS, maxHeightCells: rows, imageId: portraitId, moveCursor: false });
			portrait = { rows, image: result ? aboveBackgrounds(result.sequence) : "" };
		}
		return portrait.image;
	};
	const project = process.cwd().replace(homedir(), "~");
	const branch = branchReader(process.cwd());

	const open = (ctx: ExtensionContext): void => {
		if (handle || opening) return;
		opening = true;
		void ctx.ui.custom<void>(
			tui => {
				terminalRows = tui.terminal.rows;
				write = data => tui.terminal.write(data);
				let image: { png: string; cols: number; rows: number; room: RoomImage } | undefined;
				const sceneLines = lastResult<string[]>();
				let lastWidth: number | undefined;
				// T7: the room moves at a low frame rate only while someone acts, and never while the overlay is hidden.
				const animator = createAnimator({ onTick: () => tui.requestRender() });
				const acting = (): boolean => isActing(frameFromSnapshot(hub.snapshot()));
				animate = on => animator.update(on && acting());
				repaint = () => tui.requestRender();
				// The overlay shrinking or growing exposes or covers Pi's rows, which only a full repaint redraws.
				let lastReserved = reserved();
				forceRepaint = () => queueMicrotask(() => tui.requestRender(true));
				// Pi's own input path, used to replay the dialog's answer one key at a time (private in the types, present at runtime).
				const replay = (tui as unknown as { handleTerminalInput?: (data: string) => void }).handleTerminalInput?.bind(tui);
				const stopKeys = tui.addInputListener(data => {
					const choice = selector?.choice;
					if (handle?.isHidden() || isKeyRelease(data)) return undefined;
					// T9: a reply longer than the dialog scrolls with PgUp/PgDn and shift+up/down; other keys stay Pi's.
					if (!choice?.active()) {
						const scroll = dialogScrollKey(data);
						if (!scroll || !dialogView || dialogView.total <= dialogView.rows) return undefined;
						dialogTop = scrollDialog(dialogTop, dialogView, scroll);
						tui.requestRender();
						return { consume: true };
					}
					const key: SelectorKey = matchesKey(data, "up") ? "up" : matchesKey(data, "down") ? "down" : matchesKey(data, "enter") || matchesKey(data, "return") ? "enter" : "other";
					const step = choice.key(key);
					if (step.done) {
						editing = step.editing === true;
						forceRepaint?.();
						queueMicrotask(() => { for (const forwarded of step.forward ?? []) replay?.(forwarded); });
					}
					tui.requestRender();
					return step.consume ? { consume: true } : undefined;
				});
				const unsubscribe = hub.subscribe(() => {
					syncSelector(replay !== undefined);
					animator.update(!(handle?.isHidden() ?? false) && acting());
					if (reserved() !== lastReserved) {
						lastReserved = reserved();
						forceRepaint?.();
					}
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
						const layout = gameLayout(width, Math.max(1, terminalRows - reserved()), getCellDimensions(), { panel: panelShown });
						if (!layout) return [];
						const snapshot = hub.snapshot();
						const png = pngFor({ ...frameFromSnapshot(snapshot), todo: boardRows(todo), jobs: jobsFromChat(chat), motion: animator.running(), t: animator.step() });
						if (resendRoom || image?.png !== png || image.cols !== layout.roomCols || image.rows !== layout.bodyRows) {
							resendRoom = false;
							const { id, retire } = nextRoomId(roomIds, shownRoom);
							shownRoom = id;
							image = { png, cols: layout.roomCols, rows: layout.bodyRows, room: roomImage(png, layout.roomCols, layout.bodyRows, id) };
							// T10: the data goes to the terminal now, before Pi writes the lines; the line only places it.
							write?.(image.room.transmit);
							// L29: the old room goes only after Pi has written this render, with the new one already placed.
							if (retire !== undefined) queueMicrotask(() => write?.(deleteKittyImage(retire)));
						}
						// T10: typing renders the screen again with nothing new in the scene; reuse the lines until an input changes.
						const shownNotice = currentNotice(notice, Date.now());
						const inputs = [width, layout.bodyRows, layout.roomCols, image.room.lines[0], JSON.stringify(snapshot), chat, todo, shownNotice, panelShown, thoughtsShown, dialogTop, editing, selector?.choice.active(), selector?.choice.index(), branch()];
						return sceneLines(inputs, () => {
							const lines = chatLines(chat, { width: layout.sideCols - 4, thoughtsShown, markdown });
							const side = panelShown ? gameSide(snapshot, lines, layout.bodyRows, layout.sideCols, { doing: doingNow(todo), notice: shownNotice }) : hiddenPanel(layout.bodyRows, layout.sideCols);
							// T4d: the current reply, or an open question, in a dialog over the bottom of the room.
							const reply = currentReply(chat);
							const question = snapshot.ask?.questions[0];
							const driving = selector?.choice.active() === true;
							const ask = question && !editing
								? { question: question.question, options: question.options, custom: question.custom === true && driving, selected: driving ? selector!.choice.index() : 0, interactive: driving }
								: null;
							const dialogWidth = layout.roomCols - 4;
							// T4b: with room for the portrait the text starts after it, and the box keeps the portrait's 4 rows.
							const withPortrait = portraitFits(Number.POSITIVE_INFINITY, dialogWidth);
							const replyLines = reply ? markdown(reply, dialogWidth - 4 - (withPortrait ? PORTRAIT_COLS + 1 : 0)) : [];
							const wanted = (ask ? ask.options.length + (ask.custom ? 1 : 0) + (ask.interactive ? 1 : 0) + 1 : replyLines.length) + 2;
							const dialogHeight = Math.min(Math.max(4, Math.floor(layout.bodyRows * 0.35)), Math.max(withPortrait ? 4 : 3, wanted));
							const showPortrait = Boolean(reply || ask) && portraitFits(dialogHeight, dialogWidth);
							dialogView = reply && !ask ? { total: replyLines.length, rows: dialogHeight - 2 } : undefined;
							const dialog = reply || ask ? gameDialog({ reply: replyLines, ask, top: dialogTop }, dialogWidth, dialogHeight, showPortrait ? { image: portraitFor(dialogHeight - 2) } : undefined) : undefined;
							// A Kitty image stays until deleted: when the dialog goes away, so must its portrait.
							if (portraitShown && !showPortrait) queueMicrotask(() => write?.(deleteKittyImage(portraitId)));
							portraitShown = showPortrait;
							// T4f: project and branch, the context left and the brand are signs in the room, not a HUD row.
							const signs = [...sceneSigns({ project, branch: branch(), percent: snapshot.context.percent }, image.room), ...todoSigns(todo, image.room)];
							return composeGame(layout, { hud: "", room: image.room.lines, side, dialog, signs });
						});
					},
					invalidate() {
						image = undefined;
						portrait = undefined;
					},
					dispose() {
						stopKeys();
						repaint = undefined;
						forceRepaint = undefined;
						animator.stop();
						unsubscribe();
					},
				};
			},
			{
				overlay: true,
				overlayOptions: () => ({ anchor: "top-left", width: "100%", maxHeight: Math.max(1, terminalRows - reserved()), margin: 0, nonCapturing: true }),
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
			// T4b: each todo call returns the whole list; it feeds Doing now and the chalkboard's TODO rows.
			const tasks = todoFromToolEnd(event);
			if (tasks) {
				todo = tasks;
				repaint?.();
			}
			// A new message from you starts a new reply: the dialog follows its tail again.
			if (event.type === "input") dialogTop = null;
			const next = reduceChat(chat, { ...event, at: Date.now() });
			if (next === chat) return;
			chat = next;
			repaint?.();
		},
		/** A Pi prompt opened (+1) or closed (-1): the overlay makes room for it. */
		prompt(change: number): void {
			prompts = Math.max(0, prompts + change);
			forceRepaint?.();
			repaint?.();
		},
		/** The newest notice from any extension: shown now, and repainted away after NOTICE_MS. */
		notice(next: Notice): void {
			notice = next;
			repaint?.();
			setTimeout(() => repaint?.(), NOTICE_MS).unref?.();
		},
		/** The todo list rebuilt from the session (resume); null keeps the current one. */
		restoreTodo(tasks: readonly TodoTask[] | null): void {
			if (tasks) todo = tasks;
		},
		togglePanel(): void {
			panelShown = !panelShown;
			// The room changes place and maybe size: repaint the whole screen once.
			forceRepaint?.();
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
			if (hide) {
				write?.(deleteKittyImage(roomIds[0]) + deleteKittyImage(roomIds[1]) + deleteKittyImage(portraitId));
				shownRoom = undefined;
				resendRoom = true;
				// Shown again, the portrait must be transmitted again.
				portrait = undefined;
				portraitShown = false;
			}
		},
	};
}
