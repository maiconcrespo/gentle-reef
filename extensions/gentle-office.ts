import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Image, allocateImageId, getCapabilities } from "@earendil-works/pi-tui";
import { OfficeHub, type OfficeSnapshot } from "../src/adapter/hub.ts";
import { createOfficeServer } from "../src/server/office-server.ts";
import { openInBrowser } from "../src/server/open-browser.ts";
import { frameFromSnapshot, renderHqPng } from "../src/stage/frame.ts";
import { registerOffice, type TerminalStage } from "../src/toggle.ts";

// Thin wiring only. Event mapping and state live in src/ so they stay testable.
// The window server is built here but binds nothing until `/office open`.
// Terminal mode (GENTLE_REEF=1, set by bin/gentle-reef) is read in src/toggle.ts. Nothing is persisted between sessions.
export default function gentleOffice(pi: ExtensionAPI): void {
	const hub = new OfficeHub();
	const server = createOfficeServer({
		hub,
		assetsDir: fileURLToPath(new URL("../web/", import.meta.url)),
		openUrl: url => openInBrowser(url),
	});
	registerOffice(pi, { hub, server, stage: kittyStage() });
}

/** Share of the terminal height the stage may take; the chat and the editor keep the rest. */
const STAGE_HEIGHT_SHARE = 0.55;

/**
 * The terminal stage (issue #1, T1 spike): the Gentle HQ room as one Kitty image above the editor.
 * One image id for the whole session, so each new frame replaces the previous one instead of stacking.
 * The PNG is re-encoded only when what the room shows changes.
 */
function kittyStage(): TerminalStage {
	let imageId: number | undefined;
	let last: { key: string; png: string } | undefined;
	const pngFor = (snapshot: OfficeSnapshot): string => {
		const frame = frameFromSnapshot(snapshot);
		const key = JSON.stringify(frame);
		if (last?.key !== key) last = { key, png: renderHqPng(frame) };
		return last.png;
	};
	return {
		available: () => getCapabilities().images === "kitty",
		widget: snapshot => {
			const png = pngFor(snapshot);
			return tui => {
				imageId ??= allocateImageId();
				const rows = Math.max(8, Math.floor((tui?.terminal?.rows ?? 40) * STAGE_HEIGHT_SHARE));
				return new Image(png, "image/png", { fallbackColor: text => text }, { maxWidthCells: 400, maxHeightCells: rows, imageId });
			};
		},
	};
}
