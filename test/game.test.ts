import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeGame, gameHud, gameLayout, gameSide, plainWidth } from "../src/stage/game.ts";

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

	it("HUD on top, then each row: room line padded to its width, the gap, the side text cut to its width", () => {
		const lines = composeGame(layout, { hud: "HQ", room: ["\x1b_Gimg\x1b\\", ""], side: ["DOING NOW", "chat"] });
		assert.equal(lines.length, 4);
		assert.equal(lines[0], "HQ".padEnd(17));
		assert.equal(lines[1], "\x1b_Gimg\x1b\\" + " ".repeat(6) + " │ " + "DOING NO");
		assert.equal(lines[2], " ".repeat(6) + " │ " + "chat    ");
		assert.equal(lines[3], " ".repeat(6) + " │ " + " ".repeat(8));
	});

	it("every line has the full visible width, escapes not counted", () => {
		const lines = composeGame(layout, { hud: "\x1b[1mHQ\x1b[0m", room: ["\x1b_Gimg\x1b\\"], side: ["\x1b[33mx\x1b[0m"] });
		for (const line of lines) assert.equal(plainWidth(line), 17);
	});
});

describe("game mode text", () => {
	const snapshot = (over: Record<string, unknown> = {}) => ({ v: 1, orchestrator: { state: "idle" }, context: { percent: null }, compaction: null, agents: [], ask: null, ...over }) as never;

	it("HUD: brand, project, context, and the keys for thoughts and plain Pi", () => {
		assert.equal(plainText(gameHud(snapshot({ context: { percent: 38 } }), { project: "~/gentle-reef" })), " ✿ GENTLE HQ · ~/gentle-reef · ctx 38% · alt+t thoughts · alt+g plain chat");
		assert.match(plainText(gameHud(snapshot(), { project: "~/x" })), /ctx — /);
	});

	it("side column: the orchestrator's state, then each agent in flight with its role and status", () => {
		const side = gameSide(snapshot({
			orchestrator: { state: "waiting-user" },
			agents: [
				{ v: 1, type: "subagent", id: "a", agent: "gentle-ai-worker", role: "worker", label: "gentle-ai-worker", status: "running" },
				{ v: 1, type: "subagent", id: "b", agent: "gentle-ai-explore", role: "explore", label: "gentle-ai-explore", status: "completed" },
			],
		}), [], 10).map(plainText);
		assert.deepEqual(side.slice(0, 6), ["PARTY", "▶ orchestrator  waiting for you", "▶ worker        running", "", "CHAT", "Write below; the orchestrator answers here."]);
	});

	it("the chat fills the rows left under the party, newest at the bottom", () => {
		const chat = ["c1", "c2", "c3", "c4", "c5"];
		const side = gameSide(snapshot(), chat, 7).map(plainText);
		assert.deepEqual(side, ["PARTY", "▶ orchestrator  resting", "", "CHAT", "c3", "c4", "c5"]);
	});
});
