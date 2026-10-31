import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { belowBackgrounds, composeGame, gameDialog, gameHud, gameLayout, gameSide, plainWidth, rowsBelow } from "../src/stage/game.ts";

const plainText = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

describe("game mode layout (T3)", () => {
	it("gives the room the width its height allows, and the rest to the text column", () => {
		// 20 body rows of 19 px are 380 px tall; the room is 720x408, so it is 670 px wide, 74 cells of 9 px.
		const layout = gameLayout(200, 21, { widthPx: 9, heightPx: 19 });
		assert.deepEqual(layout, { hudRows: 1, bodyRows: 20, roomCols: 74, gap: 3, sideCols: 123 });
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

	it("HUD: badge, brew cups for the context left, project, and the keys", () => {
		assert.equal(plainText(gameHud(snapshot({ context: { percent: 38 } }), { project: "~/gentle-reef" })), " ✿ GENTLE HQ  BREW ▮▮▮▮▮▮▯▯▯▯ 62%  ~/gentle-reef  alt+t thoughts · alt+g plain chat");
		assert.match(plainText(gameHud(snapshot(), { project: "~/x" })), /BREW ▮▮▮▮▮▮▮▮▮▮ — /);
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
			"╚════════════════════════════╝",
		]);
	});

	it("an empty chat says where to write", () => {
		const side = gameSide(snapshot(), [], 7, 52).map(plainText);
		assert.equal(side[4], "║ Write below; the orchestrator answers here.      ║");
	});

	it("every side line has the column width", () => {
		for (const line of gameSide(snapshot(), ["x".repeat(40)], 8, 24)) assert.equal(plainWidth(line), 24);
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
		assert.deepEqual(box, ["╔═ ORCHESTRATOR ═══╗", "║ l2               ║", "║ l3               ║", "║ l4               ║", "╚══════════════════╝"]);
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
