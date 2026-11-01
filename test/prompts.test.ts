import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wrapPrompts } from "../src/stage/prompts.ts";

describe("Pi prompts under game mode (S8)", () => {
	it("each select, confirm, input and editor is counted open while it waits and closed when it answers", async () => {
		const changes: number[] = [];
		let answer!: (value: boolean) => void;
		const ui = {
			select: async (title: string, options: string[]) => `${title}:${options[1]}`,
			confirm(this: unknown, _title: string, _message: string) { return new Promise<boolean>(resolve => { answer = resolve; }); },
			input: async () => "typed",
			editor: async () => "edited",
		};
		assert.equal(wrapPrompts(ui, change => changes.push(change)), true);
		const confirmed = ui.confirm("Allow git push?", "git push -u origin feat");
		assert.deepEqual(changes, [1]);
		answer(true);
		assert.equal(await confirmed, true);
		assert.deepEqual(changes, [1, -1]);
		assert.equal(await ui.select("Pick", ["a", "b"]), "Pick:b");
		assert.equal(await ui.input(), "typed");
		assert.equal(await ui.editor(), "edited");
		assert.deepEqual(changes, [1, -1, 1, -1, 1, -1, 1, -1]);
	});

	it("a prompt that fails is closed too, and the error still reaches the caller", async () => {
		const changes: number[] = [];
		const ui = { confirm: async () => { throw new Error("aborted"); } };
		wrapPrompts(ui, change => changes.push(change));
		await assert.rejects(ui.confirm(), /aborted/);
		assert.deepEqual(changes, [1, -1]);
	});

	it("custom components are not counted: the scene is one", () => {
		const changes: number[] = [];
		const ui = { custom: async () => undefined };
		wrapPrompts(ui, change => changes.push(change));
		void ui.custom();
		assert.deepEqual(changes, []);
	});

	it("wraps only once, and a stage that throws never stops the prompt", async () => {
		const ui = { confirm: async () => true };
		let calls = 0;
		wrapPrompts(ui, () => { calls++; throw new Error("boom"); });
		assert.equal(wrapPrompts(ui, () => calls++), false);
		assert.equal(await ui.confirm(), true);
		assert.equal(calls, 2);
	});

	it("a frozen ui is left alone", () => {
		assert.equal(wrapPrompts(Object.freeze({ confirm: async () => true }), () => {}), false);
	});
});
