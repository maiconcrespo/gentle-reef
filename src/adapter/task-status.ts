import { roleForAgent } from "../contract/classify.ts";
import { OFFICE_EVENT_VERSION, type OfficeTaskStatus, type SubagentEvent } from "../contract/office-event.ts";

// gentle-pi publishes task status changes on this channel (lib/notification-events.ts:8).
// The payload carries only taskId and status; agent, label, tokens and cost are on TaskRecord.
export const GENTLE_NOTIFICATION_SOURCE_EVENT = "gentle-pi:notification:source";

// Mirrors TaskStatus in gentle-pi lib/agents-protocol.ts. `timed_out` is real even though the spec list omits it.
const TASK_STATUSES: ReadonlyMap<string, OfficeTaskStatus> = new Map(
	(["queued", "running", "waiting", "completed", "failed", "cancelled", "timed_out"] as const).map(status => [status, status]),
);

const UNKNOWN_AGENT = "unknown";

export function toOfficeTaskStatus(status: unknown): OfficeTaskStatus | undefined {
	return typeof status === "string" ? TASK_STATUSES.get(status) : undefined;
}

/** Subset of gentle-pi TaskRecord that the office renders. */
export interface TaskRecordLike {
	readonly id: string;
	readonly agent: string;
	readonly label: string;
	readonly status: string;
	readonly parentSessionId: string;
	readonly tokens?: number;
	readonly cost?: number;
}

interface SubagentFields {
	readonly id: string;
	readonly agent: string;
	readonly label: string;
	readonly status: OfficeTaskStatus;
	readonly parentSessionId?: string;
	readonly tokens?: number;
	readonly cost?: number;
}

function subagent(fields: SubagentFields): SubagentEvent {
	return {
		v: OFFICE_EVENT_VERSION,
		type: "subagent",
		id: fields.id,
		agent: fields.agent,
		role: roleForAgent(fields.agent),
		label: fields.label,
		status: fields.status,
		...(fields.parentSessionId === undefined ? {} : { parentSessionId: fields.parentSessionId }),
		...(fields.tokens === undefined ? {} : { tokens: fields.tokens }),
		...(fields.cost === undefined ? {} : { cost: fields.cost }),
	};
}

export function subagentFromRecord(record: TaskRecordLike): SubagentEvent | undefined {
	const status = toOfficeTaskStatus(record.status);
	if (status === undefined) return undefined;
	return subagent({
		id: record.id,
		agent: record.agent,
		label: record.label,
		status,
		parentSessionId: record.parentSessionId,
		tokens: record.tokens,
		cost: record.cost,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function subagentFromNotification(payload: unknown): SubagentEvent | undefined {
	if (!isRecord(payload) || payload.source !== "subagent") return undefined;
	if (typeof payload.taskId !== "string" || payload.taskId.length === 0) return undefined;
	const status = toOfficeTaskStatus(payload.status);
	if (status === undefined) return undefined;
	return subagent({
		id: payload.taskId,
		agent: UNKNOWN_AGENT,
		label: "",
		status,
		parentSessionId: typeof payload.parentSessionId === "string" ? payload.parentSessionId : undefined,
	});
}
