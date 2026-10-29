import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_BOSS_INPUT_CHARS, validateBossInput } from "../src/contract/inbound.ts";

describe("validateBossInput", () => {
	it("accepts a boss.input message and returns the normalized event", () => {
		assert.deepEqual(validateBossInput({ type: "boss.input", text: "ship the office" }), {
			ok: true,
			event: { v: 1, type: "boss.input", text: "ship the office" },
		});
	});

	it("accepts an explicit contract version 1", () => {
		assert.equal(validateBossInput({ v: 1, type: "boss.input", text: "hi" }).ok, true);
	});

	it("rejects a message that is not an object", () => {
		for (const value of [null, "boss.input", ["boss.input"], 7]) {
			assert.equal(validateBossInput(value).ok, false);
		}
	});

	it("rejects other message types and unknown contract versions", () => {
		assert.equal(validateBossInput({ type: "orchestrator", text: "hi" }).ok, false);
		assert.equal(validateBossInput({ v: 2, type: "boss.input", text: "hi" }).ok, false);
	});

	it("rejects non-string text", () => {
		assert.equal(validateBossInput({ type: "boss.input", text: 42 }).ok, false);
		assert.equal(validateBossInput({ type: "boss.input" }).ok, false);
	});

	it("rejects empty and whitespace-only text", () => {
		assert.equal(validateBossInput({ type: "boss.input", text: "" }).ok, false);
		assert.equal(validateBossInput({ type: "boss.input", text: "   \n\t " }).ok, false);
	});

	it("accepts text up to the limit and rejects one character over it", () => {
		assert.equal(validateBossInput({ type: "boss.input", text: "x".repeat(MAX_BOSS_INPUT_CHARS) }).ok, true);
		const over = validateBossInput({ type: "boss.input", text: "x".repeat(MAX_BOSS_INPUT_CHARS + 1) });
		assert.equal(over.ok, false);
	});
});
