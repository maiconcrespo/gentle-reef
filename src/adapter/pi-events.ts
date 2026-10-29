import { featureForTool } from "../contract/classify.ts";
import { OFFICE_EVENT_VERSION, type OfficeEvent, type OrchestratorState } from "../contract/office-event.ts";

// The Pi payloads this adapter reads (dist/core/extensions/types.d.ts). Other fields are ignored.
export type PiEvent =
	| { readonly type: "agent_start" }
	| { readonly type: "turn_start" }
	| { readonly type: "turn_end" }
	| { readonly type: "agent_settled" }
	| { readonly type: "tool_execution_start"; readonly toolName: string; readonly toolCallId?: string; readonly args?: unknown }
	| { readonly type: "tool_execution_end"; readonly toolName: string; readonly isError: boolean; readonly toolCallId?: string; readonly result?: unknown }
	| { readonly type: "session_before_compact" }
	| { readonly type: "session_compact" }
	| { readonly type: "session_compact_failed" };

/** Read from ctx.getContextUsage(); event payloads do not carry it. */
export interface UsageReading {
	readonly percent: number | null;
}

const ASK_TOOL_PREFIX = "ask_user";

const orchestrator = (state: OrchestratorState, toolName?: string): OfficeEvent =>
	toolName === undefined
		? { v: OFFICE_EVENT_VERSION, type: "orchestrator", state }
		: { v: OFFICE_EVENT_VERSION, type: "orchestrator", state, toolName };

const contextFrom = (usage: UsageReading | undefined): OfficeEvent[] =>
	usage === undefined ? [] : [{ v: OFFICE_EVENT_VERSION, type: "context", percent: usage.percent }];

export function piEventToOffice(event: PiEvent, usage?: UsageReading): OfficeEvent[] {
	switch (event.type) {
		case "agent_start":
		case "turn_start":
			return [orchestrator("thinking")];
		case "turn_end":
			return contextFrom(usage);
		case "agent_settled":
			return [orchestrator("idle"), ...contextFrom(usage)];
		case "tool_execution_start": {
			const out: OfficeEvent[] = [
				{ v: OFFICE_EVENT_VERSION, type: "tool", actor: "orchestrator", toolName: event.toolName, phase: "start" },
				orchestrator(event.toolName.startsWith(ASK_TOOL_PREFIX) ? "waiting-user" : "tool", event.toolName),
			];
			const feature = featureForTool(event.toolName);
			if (feature) out.push({ v: OFFICE_EVENT_VERSION, type: "feature", feature, detail: event.toolName });
			return out;
		}
		case "tool_execution_end":
			return [
				{ v: OFFICE_EVENT_VERSION, type: "tool", actor: "orchestrator", toolName: event.toolName, phase: "end", ok: !event.isError },
				orchestrator("thinking"),
			];
		case "session_before_compact":
			return [{ v: OFFICE_EVENT_VERSION, type: "compaction", phase: "start" }];
		case "session_compact":
			return [{ v: OFFICE_EVENT_VERSION, type: "compaction", phase: "end" }];
		case "session_compact_failed":
			return [{ v: OFFICE_EVENT_VERSION, type: "compaction", phase: "failed" }];
		default:
			return [];
	}
}
