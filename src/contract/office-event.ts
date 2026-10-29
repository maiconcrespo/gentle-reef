// Normalized Gentle Office contract. Types only: no Pi, gentle-pi, or DOM imports.
// Every outbound event carries `v` so the renderer can reject a shape it does not know.

export const OFFICE_EVENT_VERSION = 1 as const;

export type Role = "explore" | "worker" | "verify" | "inspector" | "judge";

export type Feature =
	| "music"
	| "design"
	| "memory"
	| "web"
	| "todo"
	| "ask"
	| "review"
	| "judgment"
	| "mcp"
	| "codegraph"
	| "other";

export type OfficeTaskStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "timed_out";

export type OrchestratorState = "thinking" | "tool" | "idle" | "waiting-user";

export type CompactionPhase = "start" | "end" | "failed";

export interface OrchestratorEvent {
	readonly v: typeof OFFICE_EVENT_VERSION;
	readonly type: "orchestrator";
	readonly state: OrchestratorState;
	readonly toolName?: string;
}

export interface ToolEvent {
	readonly v: typeof OFFICE_EVENT_VERSION;
	readonly type: "tool";
	readonly actor: string;
	readonly toolName: string;
	readonly phase: "start" | "end";
	/** Present on `end` only. */
	readonly ok?: boolean;
}

export interface SubagentEvent {
	readonly v: typeof OFFICE_EVENT_VERSION;
	readonly type: "subagent";
	readonly id: string;
	/** `unknown` when only a status notification was seen. */
	readonly agent: string;
	readonly role: Role;
	readonly label: string;
	readonly status: OfficeTaskStatus;
	readonly parentSessionId?: string;
	readonly tokens?: number;
	readonly cost?: number;
}

export interface ContextEvent {
	readonly v: typeof OFFICE_EVENT_VERSION;
	readonly type: "context";
	/** `null` when Pi cannot estimate usage yet (for example right after compaction). */
	readonly percent: number | null;
}

export interface CompactionEvent {
	readonly v: typeof OFFICE_EVENT_VERSION;
	readonly type: "compaction";
	readonly phase: CompactionPhase;
}

export interface FeatureEvent {
	readonly v: typeof OFFICE_EVENT_VERSION;
	readonly type: "feature";
	readonly feature: Feature;
	readonly detail: string;
}

export type OfficeEvent =
	| OrchestratorEvent
	| ToolEvent
	| SubagentEvent
	| ContextEvent
	| CompactionEvent
	| FeatureEvent;
