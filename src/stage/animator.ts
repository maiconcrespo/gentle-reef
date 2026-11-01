import type { HqFrame } from "./frame.ts";

/** Frames per second while someone acts. web/hq-scene.js counts its animation steps at this rate. */
export const ANIMATION_FPS = 4;

/** Someone acts: the orchestrator thinks or waits for you, a writer works, the explorer explores, the judges judge, or a compaction brews. */
export function isActing(frame: HqFrame): boolean {
	return Boolean(frame.thinking || frame.waiting || frame.working || frame.exploring || frame.judging || frame.brewing);
}

export interface Animator {
	/** Starts the ticks when someone acts, stops them when the room is still. Repeated calls are free. */
	update(acting: boolean): void;
	/** The current animation step, passed to drawHq as `t`. */
	step(): number;
	running(): boolean;
	stop(): void;
}

/**
 * Low-rate animation for the terminal stage (T7): a timer runs only while someone acts, so an idle session costs no
 * redraws. Timers are injected so tests drive the clock.
 */
export function createAnimator(options: {
	onTick: (step: number) => void;
	setInterval?: (fn: () => void, ms: number) => unknown;
	clearInterval?: (id: any) => void;
}): Animator {
	const start = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
	const clear = options.clearInterval ?? (id => clearInterval(id));
	let timer: unknown;
	let step = 0;
	const stop = (): void => {
		if (timer === undefined) return;
		clear(timer);
		timer = undefined;
	};
	return {
		update(acting) {
			if (!acting) return stop();
			if (timer !== undefined) return;
			timer = start(() => {
				step += 1;
				options.onTick(step);
			}, 1000 / ANIMATION_FPS);
			// Never keep Pi alive just to animate the room.
			(timer as { unref?: () => void } | undefined)?.unref?.();
		},
		step: () => step,
		running: () => timer !== undefined,
		stop,
	};
}
