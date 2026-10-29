import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OfficeHub } from "../src/adapter/hub.ts";
import { registerOffice } from "../src/toggle.ts";

// Thin wiring only. Event mapping and state live in src/ so they stay testable.
export default function gentleOffice(pi: ExtensionAPI): void {
	registerOffice(pi, { agentDir: getAgentDir(), hub: new OfficeHub() });
}
