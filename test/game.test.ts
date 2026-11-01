import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PORTRAIT_COLS, aboveBackgrounds, hiddenPanel, nextRoomId, scrollDialog, splitKitty, belowBackgrounds, composeGame, gameDialog, portraitFits, gameLayout, gameSide, plainWidth, rowsBelow, sceneSigns, todoSigns, roomDataLost, itemChips, itemsTray, ITEM_COLS, fit } from "../src/stage/game.ts";

const plainText = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

describe("game mode layout (T3)", () => {
	it("gives the room the width its height allows, and the rest to the text column", () => {
		// No HUD row (T4f: the status lives in the scene). 21 rows of 19 px are 399 px; the room is 720x408, so 704 px, 78 cells of 9 px.
		const layout = gameLayout(200, 21, { widthPx: 9, heightPx: 19 });
		assert.deepEqual(layout, { hudRows: 0, bodyRows: 21, inset: 0, roomCols: 78, gap: 3, sideCols: 119 });
	});

	it("keeps at least 32 columns of text: a narrow terminal shrinks the room", () => {
		const layout = gameLayout(100, 41, { widthPx: 9, heightPx: 19 });
		assert.equal(layout.sideCols, 32);
		assert.equal(layout.roomCols, 100 - 32 - 3);
	});

	it("panel hidden (alt+c, S1): no side column; the room is centred in the width and grows when the panel limited it", () => {
		// Height-limited: still 78 cells, centred in 200 (61 blank cells left, 61 right).
		assert.deepEqual(gameLayout(200, 21, { widthPx: 9, heightPx: 19 }, { panel: false }), { hudRows: 0, bodyRows: 21, inset: 61, roomCols: 78, gap: 0, sideCols: 61 });
		// Width-limited with the panel (65 cells): without it the room takes the width its height allows, 100 cells here.
		const wide = gameLayout(100, 41, { widthPx: 9, heightPx: 19 }, { panel: false });
		assert.equal(wide.roomCols, 100);
		assert.equal(wide.inset + wide.roomCols + wide.gap + wide.sideCols, 100);
	});

	it("is not viable below 60 columns or 8 rows (null: plain Pi stays)", () => {
		assert.equal(gameLayout(59, 30, { widthPx: 9, heightPx: 19 }), null);
		assert.equal(gameLayout(120, 7, { widthPx: 9, heightPx: 19 }), null);
	});
});

describe("game mode lines", () => {
	const layout = { hudRows: 1, bodyRows: 3, inset: 0, roomCols: 6, gap: 3, sideCols: 8 };

	it("an inset puts blank cells before the room on every row (the room centred with the panel hidden)", () => {
		const lines = composeGame({ ...layout, hudRows: 0, inset: 2 }, { hud: "", room: ["\x1b_Gimg\x1b\\"], side: ["x"] });
		assert.equal(lines[0], "  " + "\x1b_Gimg\x1b\\" + " ".repeat(6) + "   " + "x".padEnd(8));
		for (const line of lines) assert.equal(plainWidth(line), 19);
	});

	it("hidden panel lines (S1): blank, with the key to bring the panel back on the last row", () => {
		assert.deepEqual(hiddenPanel(3, 20).map(plainText), [" ".repeat(20), " ".repeat(20), "  alt+c panel       "]);
		assert.deepEqual(hiddenPanel(2, 4).map(plainText), ["    ", "    "], "too narrow for the key: blank");
	});

	it("HUD on top, then each row: room line padded to its width, a blank gap, the side text cut to its width", () => {
		const lines = composeGame(layout, { hud: "HQ", room: ["\x1b_Gimg\x1b\\", ""], side: ["DOING NOW", "chat"] });
		assert.equal(lines.length, 4);
		assert.equal(lines[0], "HQ".padEnd(17));
		assert.equal(lines[1], "\x1b_Gimg\x1b\\" + " ".repeat(6) + "   " + "DOING NO");
		assert.equal(lines[2], " ".repeat(6) + "   " + "chat    ");
		assert.equal(lines[3], " ".repeat(6) + "   " + " ".repeat(8));
	});

	it("every line has the full visible width, escapes not counted", () => {
		const lines = composeGame(layout, { hud: "\x1b[1mHQ\x1b[0m", room: ["\x1b_Gimg\x1b\\"], side: ["\x1b[33mx\x1b[0m"] });
		for (const line of lines) assert.equal(plainWidth(line), 17);
	});
});

describe("game mode text", () => {
	const snapshot = (over: Record<string, unknown> = {}) => ({ v: 1, orchestrator: { state: "idle" }, context: { percent: null }, compaction: null, agents: [], ask: null, ...over }) as never;

	it("PARTY says where the orchestrator is (T4, S4): at the monitor while it thinks or runs a tool", () => {
		for (const state of ["thinking", "tool"]) {
			assert.equal(gameSide(snapshot({ orchestrator: { state } }), [], 6, 40).map(plainText)[1], "║ ▶ orchestrator  at the monitor       ║", state);
		}
		assert.equal(gameSide(snapshot({ orchestrator: { state: "waiting-user" } }), [], 6, 40).map(plainText)[1], "║ ▶ orchestrator  waiting for you      ║");
	});

	it("side column: a PARTY box (orchestrator, then agents in flight) and a CHAT box filling the rest, newest at the bottom", () => {
		const side = gameSide(snapshot({
			agents: [
				{ v: 1, type: "subagent", id: "a", agent: "gentle-ai-worker", role: "worker", label: "gentle-ai-worker", status: "running" },
				{ v: 1, type: "subagent", id: "b", agent: "gentle-ai-explore", role: "explore", label: "gentle-ai-explore", status: "completed" },
			],
		}), ["c1", "c2", "c3", "c4", "c5"], 9, 30).map(plainText);
		assert.deepEqual(side, [
			"╔═ PARTY ════════════════════╗",
			"║ ▶ orchestrator  resting    ║",
			"║ ▶ worker        running    ║",
			"╚════════════════════════════╝",
			"╔═ CHAT ═════════════════════╗",
			"║ c3                         ║",
			"║ c4                         ║",
			"║ c5                         ║",
			"╚═ alt+t thoughts · alt+g pla╝",
		]);
	});

	it("Doing now (T4b): PARTY shows the task in progress with done/total under the orchestrator, cut to the width", () => {
		const side = gameSide(snapshot(), ["c1"], 8, 40, { doing: { title: "Write the parser for the new config", done: 1, total: 3 } }).map(plainText);
		assert.deepEqual(side.slice(0, 4), [
			"╔═ PARTY ══════════════════════════════╗",
			"║ ▶ orchestrator  resting              ║",
			"║ ◐ doing 1/3     Write the parser for ║",
			"╚══════════════════════════════════════╝",
		]);
		assert.equal(gameSide(snapshot(), [], 8, 40, { doing: null }).map(plainText)[2], "╚══════════════════════════════════════╝", "no task in progress: no row");
	});

	it("notices (T4b): a WARNING box between PARTY and CHAT, wrapped to at most 3 lines; CHAT keeps the rest", () => {
		const side = gameSide(snapshot(), ["c1", "c2", "c3"], 12, 30, { notice: { text: "Claude rate limit warning: 78% used (seven_day) and more words to wrap past three lines here", level: "warning" } }).map(plainText);
		assert.deepEqual(side.slice(3, 8), [
			"╔═ WARNING ══════════════════╗",
			"║ Claude rate limit warning: ║",
			"║ 78% used (seven_day) and   ║",
			"║ more words to wrap past    ║",
			"╚════════════════════════════╝",
		]);
		assert.equal(side[8], "╔═ CHAT ═════════════════════╗");
		assert.equal(side.length, 12);
		assert.equal(gameSide(snapshot(), [], 12, 30, { notice: { text: "x", level: "error" } }).map(plainText)[3], "╔═ ERROR ════════════════════╗");
		assert.equal(gameSide(snapshot(), [], 12, 30, { notice: { text: "x", level: "info" } }).map(plainText)[3], "╔═ NOTICE ═══════════════════╗");
	});

	it("a notice box never squeezes CHAT below its frame: no room, no box", () => {
		const side = gameSide(snapshot(), ["c1"], 7, 30, { notice: { text: "a b c d e f g h i j k l m n o p", level: "warning" } }).map(plainText);
		assert.equal(side[3], "╔═ CHAT ═════════════════════╗");
	});

	it("the CHAT frame names alt+c to hide the panel", () => {
		const side = gameSide(snapshot(), ["c1"], 6, 70).map(plainText);
		assert.match(side.at(-1)!, /alt\+t thoughts · alt\+g plain chat · alt\+c hide panel/);
	});

	it("an empty chat says where to write", () => {
		const side = gameSide(snapshot(), [], 7, 66).map(plainText);
		assert.equal(side[4], "║ " + "Write below; the orchestrator answers here.".padEnd(62) + " ║");
		assert.equal(side[6], "╚═ alt+t thoughts · alt+g plain chat · alt+c hide panel " + "═".repeat(9) + "╝", "the keys live in the CHAT frame's bottom border");
	});

	it("every side line has the column width", () => {
		for (const line of gameSide(snapshot(), ["x".repeat(40)], 8, 24)) assert.equal(plainWidth(line), 24);
	});
});

describe("the orchestrator's portrait in the dialog (T4b)", () => {
	const IMG = "\x1b_Ga=T,z=-1,i=7;AAAA\x1b\\";
	const strip = (line: string) => plainText(line).replace(/\x1b_[^\x1b]*\x1b\\/g, "");

	it("the portrait takes PORTRAIT_COLS at the left of the dialog; its image starts on the first inner row, the text moves right", () => {
		assert.equal(PORTRAIT_COLS, 8);
		const box = gameDialog({ reply: ["Hello there", "second"], ask: null }, 30, 4, { image: IMG });
		assert.deepEqual(box.map(strip), [
			"╔═ ORCHESTRATOR ═════════════╗",
			"║          Hello there       ║",
			"║          second            ║",
			"╚════════════════════════════╝",
		]);
		assert.ok(plainText(box[1]!).startsWith(`║ ${IMG}`), "the image escape sits right after the left border");
		assert.ok(!box[2]!.includes(IMG), "only the first inner row carries the image");
	});

	it("an ask dialog makes room for the portrait the same way", () => {
		const box = gameDialog({ reply: [], ask: { question: "Push now?", options: ["Yes", "No"], interactive: true } }, 30, 6, { image: IMG }).map(strip);
		assert.equal(box[1], "║          Push now?         ║");
		assert.equal(box[2], "║          ▶ Yes             ║");
	});

	it("the portrait fits only in a dialog of at least 4 rows and 40 columns", () => {
		assert.equal(portraitFits(4, 40), true);
		assert.equal(portraitFits(3, 60), false);
		assert.equal(portraitFits(8, 39), false);
	});

	it("the portrait image draws above the dialog's cell background and below its text (Kitty z=-1)", () => {
		assert.equal(aboveBackgrounds("\x1b_Ga=T,f=100,i=7;AAAA\x1b\\"), "\x1b_Ga=T,z=-1,f=100,i=7;AAAA\x1b\\");
	});
});

describe("dialog over the room (T4d)", () => {
	it("moves the room image below cell backgrounds, so the dialog's panel cells cover it and the rest shows through", () => {
		assert.equal(belowBackgrounds("\x1b_Ga=T,f=100,q=2,C=1,i=7,m=1;AAAA\x1b\\\x1b_Gm=0;BB\x1b\\"), "\x1b_Ga=T,z=-1073741825,f=100,q=2,C=1,i=7,m=1;AAAA\x1b\\\x1b_Gm=0;BB\x1b\\");
		assert.equal(belowBackgrounds("plain"), "plain");
	});

	it("draws the dialog over the bottom of the room, 2 cells in, leaving the image's first row alone", () => {
		const layout = { hudRows: 1, bodyRows: 6, roomCols: 10, gap: 1, sideCols: 2 };
		const lines = composeGame(layout, { hud: "", room: ["IMG"], side: [], dialog: ["d1", "d2"] });
		assert.equal(lines[1], "IMG" + " ".repeat(7) + "   ", "row 0 keeps the image");
		assert.equal(lines[5], "  d1      " + "   ");
		assert.equal(lines[6], "  d2      " + "   ");
		assert.equal(lines[4], " ".repeat(10) + "   ");
	});

	it("dialog box: the reply in a framed ORCHESTRATOR panel, tail first when it does not fit", () => {
		const box = gameDialog({ reply: ["l1", "l2", "l3", "l4"], ask: null }, 20, 5).map(plainText);
		assert.deepEqual(box, ["╔═ ORCHESTRATOR ═══╗", "║ l2               ║", "║ l3               ║", "║ l4               ║", "╚═ ↑1 · PgUp PgDn ═╝"]);
	});

	it("a scrolled reply (T9): `top` picks the first line shown; the bottom border counts the lines above and below and names the keys", () => {
		const box = gameDialog({ reply: ["l1", "l2", "l3", "l4", "l5"], ask: null, top: 1 }, 40, 4).map(plainText);
		assert.deepEqual(box, [
			"╔═ ORCHESTRATOR ═══════════════════════╗",
			"║ l2                                   ║",
			"║ l3                                   ║",
			"╚═ ↑1 · ↓2 · PgUp PgDn ════════════════╝",
		]);
	});

	it("a reply that fits has no scroll footer; a top past the end shows the tail", () => {
		assert.equal(plainText(gameDialog({ reply: ["l1"], ask: null }, 20, 4).at(-1)!), "╚══════════════════╝");
		const tail = gameDialog({ reply: ["l1", "l2", "l3"], ask: null, top: 9 }, 30, 4).map(plainText);
		assert.deepEqual(tail.slice(1, 3), ["║ l2                         ║", "║ l3                         ║"]);
		assert.match(tail[3]!, /↑1 · PgUp PgDn/);
	});

	it("scrollDialog: null follows the tail; up leaves it, down back at the end follows it again, pages move by the rows shown", () => {
		const view = { total: 10, rows: 3 };
		assert.equal(scrollDialog(null, view, "line-up"), 6);
		assert.equal(scrollDialog(6, view, "line-up"), 5);
		assert.equal(scrollDialog(1, view, "page-up"), 0);
		assert.equal(scrollDialog(0, view, "line-down"), 1);
		assert.equal(scrollDialog(5, view, "page-down"), null);
		assert.equal(scrollDialog(6, view, "line-down"), null);
		assert.equal(scrollDialog(null, view, "line-down"), null);
		assert.equal(scrollDialog(null, { total: 2, rows: 3 }, "line-up"), null);
	});

	it("as the selector: ▶ on the chosen option, Other… when a custom answer is allowed, and the keys", () => {
		const box = gameDialog({ reply: [], ask: { question: "Push now?", options: ["Yes", "Not yet"], custom: true, selected: 2, interactive: true } }, 30, 7).map(plainText);
		assert.deepEqual(box.slice(1, 6), [
			"║ Push now?                  ║",
			"║   Yes                      ║",
			"║   Not yet                  ║",
			"║ ▶ Other… (write your own)  ║",
			"║ ↑↓ choose · Enter · Esc    ║",
		]);
	});

	it("an open question shows instead of the reply, with its options and ▶ on the first", () => {
		const box = gameDialog({ reply: ["old"], ask: { question: "Push now?", options: ["Yes", "Not yet"] } }, 24, 6).map(plainText);
		assert.deepEqual(box.slice(0, 5), ["╔═ ORCHESTRATOR · asks ╗", "║ Push now?            ║", "║ ▶ Yes                ║", "║   Not yet            ║", "║                      ║"]);
	});
});

describe("the room image sent once (T10)", () => {
	const sequence = "\x1b_Ga=T,f=100,q=2,C=1,c=162,r=46,i=7,m=1;AAAA\x1b\\\x1b_Gm=0;BBBB\x1b\\";

	it("splits pi-tui's transmit-and-show sequence: the data is transmitted alone, the line keeps a tiny placement", () => {
		const { transmit, place } = splitKitty(sequence, { imageId: 7, columns: 162, rows: 46, z: -1_073_741_825 });
		assert.equal(transmit, "\x1b_Ga=t,f=100,q=2,C=1,c=162,r=46,i=7,m=1;AAAA\x1b\\\x1b_Gm=0;BBBB\x1b\\");
		assert.equal(place, "\x1b_Ga=p,i=7,p=1,c=162,r=46,C=1,q=2,z=-1073741825\x1b\\");
	});

	it("never deletes the shown room before the new one is placed (no blank frame, L29): the transmission holds no delete", () => {
		const { transmit } = splitKitty(sequence, { imageId: 7, columns: 162, rows: 46, z: 0 });
		assert.ok(!transmit.includes("a=d"));
	});

	it("alternates two image ids: the new frame goes to the id not on screen, and the shown one retires after the swap", () => {
		assert.deepEqual(nextRoomId([3, 4], undefined), { id: 3, retire: undefined });
		assert.deepEqual(nextRoomId([3, 4], 3), { id: 4, retire: 3 });
		assert.deepEqual(nextRoomId([3, 4], 4), { id: 3, retire: 4 });
	});

	it("the placement is short and still a Kitty line for pi-tui (starts with ESC _G), and takes no cells", () => {
		const { place } = splitKitty(sequence, { imageId: 7, columns: 162, rows: 46, z: 0 });
		assert.ok(place.length < 80);
		assert.ok(place.startsWith("\x1b_G"));
		assert.equal(plainWidth(place), 0);
	});
});

describe("readable TODO board (T11c)", () => {
	const task = (id: number, status: string, title = `task ${id}`) => ({ id, title, status }) as never;
	const image = { cols: 162, rows: 46 };

	it("a title with done/total, then one row per task on the board: ✓ done, ▶ current, · pending, dropped left out", () => {
		const signs = todoSigns([task(1, "done", "Map the code"), task(2, "dropped"), task(3, "in_progress", "Write the parser"), task(4, "pending", "Docs")], image);
		assert.deepEqual(signs.map(sign => [sign.row, sign.col, plainText(sign.text)]), [
			[17, 24, "TODO 1/3".padEnd(21)],
			[18, 24, "✓ Map the code".padEnd(21)],
			[19, 24, "▶ Write the parser".padEnd(21)],
			[20, 24, "· Docs".padEnd(21)],
		]);
	});

	it("long titles are cut to the board; at most the rows the board has, from one task before the first open one", () => {
		const tasks = [1, 2, 3, 4, 5, 6].map(id => task(id, id < 3 ? "done" : id === 3 ? "in_progress" : "pending", `a very long task title number ${id}`));
		const signs = todoSigns(tasks, image);
		assert.equal(signs.length, 5);
		assert.equal(plainText(signs[1]!.text), "✓ a very long task ti");
		assert.ok(signs.every(sign => plainWidth(sign.text) === 21));
		assert.match(plainText(signs[2]!.text), /^▶ a very long task ti/);
	});

	it("no tasks: only the TODO title", () => {
		assert.deepEqual(todoSigns([], image).map(sign => plainText(sign.text).trim()), ["TODO"]);
	});

	it("a small room keeps fewer rows, never past the board's bottom", () => {
		const tasks = [1, 2, 3, 4].map(id => task(id, "pending"));
		const signs = todoSigns(tasks, { cols: 78, rows: 21 });
		assert.ok(signs.length < 5);
		assert.ok(signs.every(sign => sign.row * 408 / 21 + 408 / 21 <= 202));
	});
});

describe("room left for Pi's prompts (T4d)", () => {
	it("leaves the editor's 4 rows normally", () => {
		assert.equal(rowsBelow({ askOptions: null, prompts: 0 }), 4);
	});

	it("an open ask_user question frees its options plus the selector's title, custom answer, hints and frame", () => {
		assert.equal(rowsBelow({ askOptions: 3, prompts: 0 }), 3 + 7);
	});

	it("any other open Pi prompt (select, confirm, input, editor) frees 12 rows; the larger need wins", () => {
		assert.equal(rowsBelow({ askOptions: null, prompts: 1 }), 12);
		assert.equal(rowsBelow({ askOptions: 9, prompts: 1 }), 16);
	});
});

describe("status signs in the scene (T4f)", () => {
	it("a framed project-and-branch sign hanging over the chalkboard, BREW under the coffee corner, the pink GENTLE HQ plaque on the orchestrator's desk", () => {
		const signs = sceneSigns({ project: "~/gentle-reef", branch: "fix/10", percent: 38 }, { cols: 80, rows: 20 }).map(sign => ({ ...sign, text: plainText(sign.text) }));
		assert.deepEqual(signs, [
			{ row: 0, col: 27, text: "║ ~/gentle-reef · fix/10 ║" },
			{ row: 1, col: 27, text: "╚════════════════════════╝" },
			{ row: 3, col: 16, text: " BREW 62% " },
			{ row: 6, col: 35, text: "✿ GENTLE HQ" },
		]);
	});

	it("the plaque is centred on the desk (x 320-416 in room pixels, y 124), not under the door", () => {
		const [, , , plaque] = sceneSigns({ project: "~/x", branch: null, percent: null }, { cols: 720, rows: 408 });
		assert.equal(plaque!.row, 124);
		assert.ok(plaque!.col >= 320 && plaque!.col + plainWidth(plaque!.text) <= 416, `col ${plaque!.col}`);
	});

	it("no branch shows the project alone; unknown context shows BREW —", () => {
		const signs = sceneSigns({ project: "~/x", branch: null, percent: null }, { cols: 80, rows: 20 }).map(sign => plainText(sign.text));
		assert.deepEqual(signs, ["║ ~/x ║", "╚═════╝", " BREW — ", "✿ GENTLE HQ"]);
	});

	it("a sign never runs past the room's right edge", () => {
		const [sign] = sceneSigns({ project: "~/" + "p".repeat(60), branch: "b", percent: 0 }, { cols: 40, rows: 10 });
		assert.ok(sign!.col + plainWidth(sign!.text) <= 40);
	});

	it("composeGame draws signs on the room rows, after the image escape on row 0, under the dialog", () => {
		const layout = { hudRows: 0, bodyRows: 4, roomCols: 12, gap: 1, sideCols: 2 };
		const lines = composeGame(layout, { hud: "", room: ["\x1b_Gi\x1b\\"], side: [], signs: [{ row: 0, col: 4, text: "AB" }, { row: 2, col: 1, text: "CD" }, { row: 3, col: 0, text: "EF" }], dialog: ["dlg"] });
		assert.equal(lines[0], "\x1b_Gi\x1b\\" + "    AB      " + "   ");
		assert.equal(lines[2], " CD         " + "   ");
		assert.equal(lines[3], "  dlg       " + "   ", "the dialog wins over a sign on its rows");
	});
});

describe("room data after a full repaint (L4)", () => {
	it("reports the room's data lost once per full repaint Pi made, and not otherwise", () => {
		let redraws = 2;
		const lost = roomDataLost(() => redraws);
		assert.equal(lost(), false);
		redraws = 3;
		assert.equal(lost(), true);
		assert.equal(lost(), false);
		redraws = 5;
		assert.equal(lost(), true);
	});
});

describe("ITEMS tray for pasted images (T7, S6)", () => {
	const layout = { hudRows: 0, bodyRows: 20, inset: 0, roomCols: 60, gap: 3, sideCols: 37 };
	const side = Array.from({ length: 20 }, (_, i) => `side ${i}`);

	it("lists each [Image#N] chip in the draft once, in order", () => {
		assert.deepEqual(itemChips("look [Image#2] and [Image#1], again [Image#2]"), ["[Image#2]", "[Image#1]"]);
		assert.deepEqual(itemChips("no images here"), []);
	});

	it("is empty without chips; with chips it has a top border, a label row per chip and 6 thumbnail rows while idle", () => {
		assert.deepEqual(itemsTray([], true), []);
		const idle = itemsTray(["[Image#1]", "[Image#2]"], true);
		assert.equal(idle.length, 1 + 2 * (1 + 6));
		assert.match(plainText(idle[0]!), /ITEMS/);
		assert.match(plainText(idle[1]!), /\[Image#1\]/);
		assert.match(plainText(idle[8]!), /\[Image#2\]/);
		for (const line of idle) assert.equal(plainWidth(line), ITEM_COLS);
		for (const line of idle.slice(1)) assert.ok(plainText(line).endsWith("║"));
		// While the agent works gentle-shell shows labels only.
		assert.equal(itemsTray(["[Image#1]"], false).length, 2);
	});

	it("covers the bottom-left corner from column 0, keeps the rest of each row, and lifts the dialog above it", () => {
		const items = itemsTray(["[Image#1]"], true);
		const dialog = ["d0", "d1", "d2"];
		const lines = composeGame(layout, { hud: "", room: [], side, dialog, items });
		assert.equal(lines.length, 20);
		const start = 20 - items.length;
		for (let i = 0; i < items.length; i++) {
			assert.equal(plainText(lines[start + i]!).slice(0, ITEM_COLS), plainText(items[i]!));
			assert.ok(plainText(lines[start + i]!).endsWith(`side ${start + i}`.padEnd(37)));
		}
		assert.equal(plainText(lines[start - 1]!).slice(2, 4), "d2");
		assert.equal(plainText(lines[start - 3]!).slice(2, 4), "d0");
		for (const line of lines) assert.equal(plainWidth(line), 100);
	});

	it("without items the layout is unchanged", () => {
		const before = composeGame(layout, { hud: "", room: [], side, dialog: ["d0"] });
		assert.deepEqual(composeGame(layout, { hud: "", room: [], side, dialog: ["d0"], items: [] }), before);
		assert.equal(plainText(before[19]!).slice(2, 4), "d0");
	});
});

describe("hyperlinks in the chat and the dialog (S7)", () => {
	// pi-tui's Markdown wraps a URL in OSC 8 hyperlinks, one pair per wrapped line: escapes that take no cells.
	const OPEN = "\x1b]8;;https://github.com/maiconcrespo/gentle-reef/pull/new/feat/terminal-scene-life\x1b\\";
	const CLOSE = "\x1b]8;;\x1b\\";
	const link = `${OPEN}\x1b[38;2;105;173;208mhttps://github.com${CLOSE}`;

	it("counts only the link's visible text", () => {
		assert.equal(plainWidth(link), "https://github.com".length);
		assert.equal(plainWidth(`\x1b]8;;https://a.io\x07a.io\x1b]8;;\x07`), 4);
	});

	it("pads a linked line to the width with both hyperlink escapes whole", () => {
		assert.equal(fit(link, 20), `${link}  `);
	});

	it("cuts the text, never the escapes: the hyperlink is still closed", () => {
		assert.equal(fit(link, 5), `${OPEN}\x1b[38;2;105;173;208mhttps${CLOSE}`);
	});
});
