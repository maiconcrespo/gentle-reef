import type { OfficeSnapshot } from "../adapter/hub.ts";
import { HQ_HEIGHT, HQ_WIDTH, drawHq } from "../../web/hq-scene.js";
import { encodePng } from "./png.ts";
import { createRaster, upscale } from "./raster.ts";

/** What one frame shows: the animation step and who is acting (see drawHq in web/hq-scene.js). */
export interface HqFrame {
	readonly t?: number;
	readonly motion?: boolean;
	readonly thinking?: boolean;
	readonly waiting?: boolean;
	readonly working?: boolean;
	readonly exploring?: boolean;
	/** Context used, 0-100, or null while Pi has not reported it (the pot stays full). */
	readonly context?: number | null;
	/** Compaction is running: the espresso machine steams. */
	readonly brewing?: boolean;
	/** Current ODD step, 0-6. */
	readonly odd?: number;
	/** TODO rows, first four drawn. */
	readonly todo?: ReadonlyArray<{ readonly done?: boolean; readonly now?: boolean }>;
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
		exploring: running.some(agent => agent.role === "explore"),
		context: snapshot.context.percent,
		brewing: snapshot.compaction === "start",
	};
}

/** The room at 2x as base64 PNG, ready for pi-tui's Image / encodeKitty. */
export function renderHqPng(frame: HqFrame, scale = 2): string {
	const raster = createRaster(HQ_WIDTH, HQ_HEIGHT);
	drawHq(raster, frame);
	const out = scale === 1 ? raster : upscale(raster, scale);
	return encodePng(out.data, out.width, out.height).toString("base64");
}
