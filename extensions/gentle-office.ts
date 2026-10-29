import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OfficeHub } from "../src/adapter/hub.ts";
import { createOfficeServer } from "../src/server/office-server.ts";
import { openInBrowser } from "../src/server/open-browser.ts";
import { registerOffice } from "../src/toggle.ts";

// Thin wiring only. Event mapping and state live in src/ so they stay testable.
// The window server is built here but binds nothing until `/office open`.
export default function gentleOffice(pi: ExtensionAPI): void {
	const hub = new OfficeHub();
	const server = createOfficeServer({
		hub,
		assetsDir: fileURLToPath(new URL("../web/", import.meta.url)),
		openUrl: url => openInBrowser(url),
	});
	registerOffice(pi, { agentDir: getAgentDir(), hub, server });
}
