import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createChoiceSelector } from "../src/stage/selector.ts";

describe("dialog selector (T4e): the game dialog drives Pi's choice list", () => {
	it("up and down move the ▶ and wrap like Pi's list; Pi never sees them", () => {
		const s = createChoiceSelector({ options: 3, custom: false });
		assert.equal(s.index(), 0);
		assert.deepEqual(s.key("up"), { consume: true });
		assert.equal(s.index(), 2, "up from the top wraps to the bottom");
		assert.deepEqual(s.key("down"), { consume: true });
		assert.equal(s.index(), 0, "down from the bottom wraps to the top");
		s.key("down");
		assert.equal(s.index(), 1);
	});

	it("Enter is swallowed and replayed into Pi's list, still on its first item: down as many times as the ▶ moved, then Enter", () => {
		const s = createChoiceSelector({ options: 3, custom: false });
		s.key("down"); s.key("down");
		assert.deepEqual(s.key("enter"), { consume: true, forward: ["\x1b[B", "\x1b[B", "\r"], done: true, editing: false });
		assert.equal(s.active(), false, "after answering, keys go to Pi again");
		assert.deepEqual(s.key("down"), { consume: false });
	});

	it("Enter on the first option forwards a plain Enter", () => {
		assert.deepEqual(createChoiceSelector({ options: 2, custom: false }).key("enter"), { consume: true, forward: ["\r"], done: true, editing: false });
	});

	it("with a custom answer the list ends with Other…, and choosing it hands the keys to Pi's editor", () => {
		const s = createChoiceSelector({ options: 2, custom: true });
		assert.equal(s.items(), 3);
		s.key("up");
		assert.equal(s.index(), 2);
		assert.deepEqual(s.key("enter"), { consume: true, forward: ["\x1b[B", "\x1b[B", "\r"], done: true, editing: true });
	});

	it("any other key (Esc, typing) passes through untouched", () => {
		const s = createChoiceSelector({ options: 2, custom: false });
		assert.deepEqual(s.key("other"), { consume: false });
		assert.equal(s.active(), true);
	});
});
