import type { OfficeSnapshot, ReviewView } from "../adapter/hub.ts";
import { HQ_HEIGHT, HQ_WIDTH, drawHq, drawHqPortrait } from "../../web/hq-scene.js";
import { encodePng } from "./png.ts";
import { createRaster, upscale } from "./raster.ts";

/** What one frame shows: the animation step and who is acting (see drawHq in web/hq-scene.js). */
export interface HqFrame {
	readonly t?: number;
	readonly motion?: boolean;
	readonly thinking?: boolean;
	readonly waiting?: boolean;
	readonly working?: boolean;
	/** Running workers: the first desks, one each, show code; the rest show a still game. */
	readonly workers?: number;
	/** No worker has run for COFFEE_AFTER_MS: the workers stand at the coffee corner. */
	readonly coffee?: boolean;
	readonly exploring?: boolean;
	/** A jd-judge agent runs: the judges debate in turns and the gavel moves. */
	readonly judging?: boolean;
	/** The judges just finished: the gavel strikes once (gavelClock). */
	readonly struck?: boolean;
	/** Context used, 0-100, or null while Pi has not reported it (the pot stays full). */
	readonly context?: number | null;
	/** Compaction is running: the espresso machine steams. */
	readonly brewing?: boolean;
	/** Current ODD step, 0-6. */
	readonly odd?: number;
	/** TODO rows, first four drawn. */
	readonly todo?: ReadonlyArray<{ readonly done?: boolean; readonly now?: boolean }>;
	/** Tool calls since the user's last message, one monitor each on the jobs wall. */
	readonly jobs?: ReadonlyArray<"running" | "ok" | "fail">;
	/** The four reviewer desks, in REVIEW_DESKS order: magnifier off, lit while its lens inspects, ok once approved. */
	readonly reviewDesks?: ReadonlyArray<ReviewDesk>;
}

export type ReviewDesk = "off" | "lit" | "ok";

/** The lens of each reviewer desk, left to right (web/hq-scene.js reviewStations: red, green, blue, gold). */
export const REVIEW_DESKS = ["risk", "resilience", "readability", "reliability"] as const;

/**
 * Which desks a review uses. A capture never says which lens it is, so every asked lens lights and is approved together.
 * Without lens names the first `count` desks stand for the lenses the capture runs; an approval with nothing known lights all.
 */
export function reviewDesks(review: ReviewView): ReviewDesk[] {
	const state: ReviewDesk | null = review.phase === "inspecting" ? "lit" : review.phase === "approved" ? "ok" : null;
	if (state === null) return REVIEW_DESKS.map(() => "off");
	const named = review.lenses.length > 0;
	const count = review.count > 0 ? review.count : REVIEW_DESKS.length;
	return REVIEW_DESKS.map((lens, i) => ((named ? review.lenses.includes(lens) : i < count) ? state : "off"));
}

/** What the room shows for a hub snapshot: who acts, the context and compaction. A still frame until T3 animates it. */
export function frameFromSnapshot(snapshot: OfficeSnapshot): HqFrame {
	const state = snapshot.orchestrator.state;
	const running = snapshot.agents.filter(agent => agent.status === "running");
	return {
		motion: false,
		thinking: state === "thinking" || state === "tool",
		waiting: state === "waiting-user",
		working: running.some(agent => agent.role === "worker"),
		workers: running.filter(agent => agent.role === "worker").length,
		judging: running.some(agent => agent.role === "judge"),
		exploring: running.some(agent => agent.role === "explore"),
		context: snapshot.context.percent,
		brewing: snapshot.compaction === "start",
		reviewDesks: reviewDesks(snapshot.review),
	};
}

/** How long the workers stay at their desks with nothing to do before they go for a coffee (S3). */
export const COFFEE_AFTER_MS = 180_000;

/** When the coffee break starts: COFFEE_AFTER_MS after the last moment a worker ran (or after `start`). */
export function coffeeClock(start: number) {
	let last = start;
	return {
		/** Whether the workers are on a break at `now`; a running worker resets the clock. */
		at(working: boolean, now: number): boolean {
			if (working) {
				last = now;
				return false;
			}
			return now - last >= COFFEE_AFTER_MS;
		},
		dueAt: (): number => last + COFFEE_AFTER_MS,
	};
}

/** How long the gavel's strike shows once the judges finish (S2). */
export const GAVEL_STRIKE_MS = 1_500;

/** The gavel strikes for GAVEL_STRIKE_MS from the moment a judgment day ends, once per judgment day. */
export function gavelClock() {
	let judged = false;
	let until = 0;
	return {
		/** Whether the gavel is striking at `now`. */
		at(judging: boolean, now: number): boolean {
			if (judging) judged = true;
			else if (judged) {
				judged = false;
				until = now + GAVEL_STRIKE_MS;
			}
			return now < until;
		},
		dueAt: (): number => until,
	};
}

/** The room at 2x as base64 PNG, ready for pi-tui's Image / encodeKitty. */
export function renderHqPng(frame: HqFrame, scale = 2): string {
	const raster = createRaster(HQ_WIDTH, HQ_HEIGHT);
	drawHq(raster, frame);
	const out = scale === 1 ? raster : upscale(raster, scale);
	return encodePng(out.data, out.width, out.height).toString("base64");
}

const PORTRAIT_PX = 24;

/** The orchestrator's dialog portrait (web/hq-scene.js drawHqPortrait) as base64 PNG at 4x: 96 x 96. */
export function renderPortraitPng(scale = 4): string {
	const raster = createRaster(PORTRAIT_PX, PORTRAIT_PX);
	drawHqPortrait(raster);
	const out = upscale(raster, scale);
	return encodePng(out.data, out.width, out.height).toString("base64");
}
