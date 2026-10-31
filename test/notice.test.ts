import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOTICE_MS, currentNotice, wrapNotify } from "../src/stage/notice.ts";

describe("notices from any extension (T4b)", () => {
	it("wrapping ui.notify hands each notice to the stage and still calls Pi's notify with the same arguments", () => {
		const shown: unknown[][] = [];
		const ui = { notify(message: string, type?: string) { shown.push([this === ui, message, type]); } };
		const seen: unknown[] = [];
		assert.equal(wrapNotify(ui, notice => seen.push(notice), () => 1000), true);
		ui.notify("Claude rate limit warning: 78% used (seven_day)", "warning");
		ui.notify("saved");
		assert.deepEqual(seen, [
			{ text: "Claude rate limit warning: 78% used (seven_day)", level: "warning", at: 1000 },
			{ text: "saved", level: "info", at: 1000 },
		]);
		assert.deepEqual(shown, [[true, "Claude rate limit warning: 78% used (seven_day)", "warning"], [true, "saved", undefined]]);
	});

	it("wraps only once: a second wrap keeps one stage call per notice", () => {
		const ui = { notify() {} };
		let calls = 0;
		wrapNotify(ui, () => calls++);
		assert.equal(wrapNotify(ui, () => calls++), false);
		ui.notify();
		assert.equal(calls, 1);
	});

	it("a stage that throws never stops Pi's notice", () => {
		const shown: string[] = [];
		const ui = { notify(message: string) { shown.push(message); } };
		wrapNotify(ui, () => { throw new Error("boom"); });
		ui.notify("still here");
		assert.deepEqual(shown, ["still here"]);
	});

	it("a ui without notify, or a frozen one, is left alone", () => {
		assert.equal(wrapNotify({}, () => {}), false);
		const frozen = Object.freeze({ notify() {} });
		assert.equal(wrapNotify(frozen, () => {}), false);
	});

	it("the newest notice shows for NOTICE_MS, then goes away; empty text is ignored", () => {
		const notice = { text: "hi", level: "warning" as const, at: 1000 };
		assert.equal(currentNotice(notice, 1000 + NOTICE_MS - 1), notice);
		assert.equal(currentNotice(notice, 1000 + NOTICE_MS), null);
		assert.equal(currentNotice(null, 0), null);
		assert.equal(currentNotice({ ...notice, text: "  " }, 1000), null);
	});
});
