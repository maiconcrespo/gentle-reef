import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ANIMATION_FPS, createAnimator, isActing } from "../src/stage/animator.ts";

function fakeClock() {
	const timers = new Map<number, () => void>();
	let next = 1;
	return {
		timers,
		setInterval: (fn: () => void, ms: number) => { assert.equal(ms, 1000 / ANIMATION_FPS); timers.set(next, fn); return next++; },
		clearInterval: (id: number) => { timers.delete(id); },
		tick: () => { for (const fn of [...timers.values()]) fn(); },
	};
}

describe("room animation (T7)", () => {
	it("someone acting is the orchestrator thinking or waiting, an agent working or exploring, or a compaction", () => {
		assert.equal(isActing({}), false);
		for (const key of ["thinking", "waiting", "working", "exploring", "brewing"]) assert.equal(isActing({ [key]: true }), true, key);
	});

	it("ticks at 4 fps only while someone acts, and stops when the room is still", () => {
		const clock = fakeClock();
		const steps: number[] = [];
		const animator = createAnimator({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, onTick: t => steps.push(t) });
		assert.equal(clock.timers.size, 0, "no timer while nobody acts");
		animator.update(true);
		animator.update(true);
		assert.equal(clock.timers.size, 1, "one timer, not one per update");
		clock.tick(); clock.tick();
		assert.deepEqual(steps, [1, 2]);
		assert.equal(animator.step(), 2);
		animator.update(false);
		assert.equal(clock.timers.size, 0);
		assert.equal(animator.running(), false);
	});

	it("stop() clears the timer for good (overlay disposed)", () => {
		const clock = fakeClock();
		const animator = createAnimator({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, onTick: () => {} });
		animator.update(true);
		animator.stop();
		assert.equal(clock.timers.size, 0);
	});
});
