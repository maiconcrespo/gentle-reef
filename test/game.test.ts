import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PORTRAIT_COLS, aboveBackgrounds, scrollDialog, belowBackgrounds, composeGame, gameDialog, portraitFits, gameLayout, gameSide, plainWidth, rowsBelow, sceneSigns } from "../src/stage/game.ts";

const plainText = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

describe("game mode layout (T3)", () => {
	it("gives the room the width its height allows, and the rest to the text column", () => {
		// No HUD row (T4f: the status lives in the scene). 21 rows of 19 px are 399 px; the room is 720x408, so 704 px, 78 cells of 9 px.
		const layout = gameLayout(200, 21, { widthPx: 9, heightPx: 19 });
		assert.deepEqual(layout, { hudRows: 0, bodyRows: 21, roomCols: 78, gap: 3, sideCols: 119 });
	});

	it("keeps at least 32 columns of text: a narrow terminal shrinks the room", () => {
		const layout = gameLayout(100, 41, { widthPx: 9, heightPx: 19 });
		assert.equal(layout.sideCols, 32);
		assert.equal(layout.roomCols, 100 - 32 - 3);
	});

	it("is not viable below 60 columns or 8 rows (null: plain Pi stays)", () => {
		assert.equal(gameLayout(59, 30, { widthPx: 9, heightPx: 19 }), null);
		assert.equal(gameLayout(120, 7, { widthPx: 9, heightPx: 19 }), null);
	});
});

describe("game mode lines", () => {
	const layout = { hudRows: 1, bodyRows: 3, roomCols: 6, gap: 3, sideCols: 8 };

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

	it("chat hidden (alt+c): PARTY stays, CHAT gives way to one line with the keys, the rest is blank", () => {
		const side = gameSide(snapshot(), ["c1", "c2"], 6, 34, { chatShown: false }).map(plainText);
		assert.deepEqual(side, [
			"╔═ PARTY ════════════════════════╗",
			"║ ▶ orchestrator  resting        ║",
			"╚════════════════════════════════╝",
			"  alt+c chat · alt+g plain chat   ",
			" ".repeat(34),
			" ".repeat(34),
		]);
	});

	it("the CHAT frame names alt+c to hide it", () => {
		const side = gameSide(snapshot(), ["c1"], 6, 70).map(plainText);
		assert.match(side.at(-1)!, /alt\+t thoughts · alt\+g plain chat · alt\+c hide chat/);
	});

	it("an empty chat says where to write", () => {
		const side = gameSide(snapshot(), [], 7, 66).map(plainText);
		assert.equal(side[4], "║ " + "Write below; the orchestrator answers here.".padEnd(62) + " ║");
		assert.equal(side[6], "╚═ alt+t thoughts · alt+g plain chat · alt+c hide chat " + "═".repeat(10) + "╝", "the keys live in the CHAT frame's bottom border");
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
	it("a framed project-and-branch sign hanging over the chalkboard, BREW under the coffee corner, the pink GENTLE HQ plaque under the door", () => {
		const signs = sceneSigns({ project: "~/gentle-reef", branch: "fix/10", percent: 38 }, { cols: 80, rows: 20 }).map(sign => ({ ...sign, text: plainText(sign.text) }));
		assert.deepEqual(signs, [
			{ row: 0, col: 27, text: "║ ~/gentle-reef · fix/10 ║" },
			{ row: 1, col: 27, text: "╚════════════════════════╝" },
			{ row: 3, col: 16, text: " BREW 62% " },
			{ row: 19, col: 34, text: " ✿ GENTLE HQ " },
		]);
	});

	it("no branch shows the project alone; unknown context shows BREW —", () => {
		const signs = sceneSigns({ project: "~/x", branch: null, percent: null }, { cols: 80, rows: 20 }).map(sign => plainText(sign.text));
		assert.deepEqual(signs, ["║ ~/x ║", "╚═════╝", " BREW — ", " ✿ GENTLE HQ "]);
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
