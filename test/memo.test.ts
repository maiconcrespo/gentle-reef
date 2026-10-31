import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lastResult } from "../src/stage/memo.ts";

describe("render memo (T10)", () => {
	it("returns the last result while every input is the same (Object.is), and computes again when one changes", () => {
		const memo = lastResult<string[]>();
		const chat = { entries: [] };
		let runs = 0;
		const compute = () => { runs += 1; return [`run ${runs}`]; };
		const first = memo([120, chat, "png-a", null], compute);
		assert.equal(memo([120, chat, "png-a", null], compute), first);
		assert.equal(runs, 1);
		assert.deepEqual(memo([120, { entries: [] }, "png-a", null], compute), ["run 2"], "a new chat object is a change");
		assert.deepEqual(memo([121, { entries: [] }, "png-a", null], compute), ["run 3"]);
		assert.deepEqual(memo([121], compute), ["run 4"], "a different number of inputs is a change");
	});
});
