import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { putListenerFirst } from "../src/stage/input-order.ts";

describe("dialog scroll keys before Pi's viewport (S9)", () => {
	// Pi's alt-screen renderer listens first and takes PgUp/PgDn to scroll the history the scene covers.
	it("moves the listener to the front and keeps the others in their order", () => {
		const viewport = () => undefined, selector = () => undefined, scroll = () => undefined;
		const tui = { inputListeners: new Set([viewport, selector, scroll]) };
		assert.equal(putListenerFirst(tui, scroll), true);
		assert.deepEqual([...tui.inputListeners], [scroll, viewport, selector]);
	});

	it("a listener not registered, or a host without the set, is left alone", () => {
		const viewport = () => undefined;
		const tui = { inputListeners: new Set([viewport]) };
		assert.equal(putListenerFirst(tui, () => undefined), false);
		assert.deepEqual([...tui.inputListeners], [viewport]);
		assert.equal(putListenerFirst({}, viewport), false);
	});
});
