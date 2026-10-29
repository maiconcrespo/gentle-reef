import { roleForAgent } from "../contract/classify.ts";
import type { SubagentEvent } from "../contract/office-event.ts";

// The Pi tool that launches a gentle-pi subagent. gentle-pi registers it as `subagent_run`
// (extensions/gentle-agents.ts:2028 `pi.registerTool`, prefix at :100, `tool("run", …)` at :2312).
export const SUBAGENT_LAUNCH_TOOL = "subagent_run";

// gentle-pi publishes only taskId and status on the notification channel. The agent and label
// are on the launch call. This bridge joins the two without reading gentle-pi internals.
const UNKNOWN_AGENT = "unknown";
const MAX_LAUNCHES = 16;
const MAX_BINDINGS = 64;

export interface SubagentIdentity {
	readonly agent: string;
	readonly label: string;
}

/** The fields of a Pi tool event this bridge reads. Other tools are ignored. */
export interface ToolEventLike {
	readonly type: string;
	readonly toolName?: string;
	readonly toolCallId?: string;
	readonly args?: unknown;
	readonly result?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** `{ agent, label }` from the launch input. The task prompt is never read or stored. */
export function launchIdentityFromArgs(args: unknown): SubagentIdentity | undefined {
	if (!isRecord(args) || typeof args.agent !== "string" || args.agent.trim() === "") return undefined;
	return { agent: args.agent.trim(), label: typeof args.label === "string" ? args.label : "" };
}

// `Started <agent> in the background as task <id>.` (gentle-agents.ts:1989)
const BACKGROUND_TEXT = /\bas task ([^\s.,;:()"']+)/;
// `Subagent <agent> (task <id>, "<label>") finished.` (gentle-agents.ts:462)
const COMPLETION_TEXT = /\(task ([^\s,()"']+)[,)]/;

/** The task id from a launch result: structured details first, then the text the model also reads. */
export function taskIdFromLaunchResult(result: unknown): string | undefined {
	if (!isRecord(result)) return undefined;
	const details = isRecord(result.details) ? result.details.gentleAgents : undefined;
	if (isRecord(details) && typeof details.taskId === "string" && details.taskId !== "") return details.taskId;
	const parts = Array.isArray(result.content) ? result.content : [];
	for (const part of parts) {
		if (!isRecord(part) || typeof part.text !== "string") continue;
		const match = BACKGROUND_TEXT.exec(part.text) ?? COMPLETION_TEXT.exec(part.text);
		if (match) return match[1];
	}
	return undefined;
}

interface Launch {
	readonly callId: string;
	readonly identity: SubagentIdentity;
	taskId?: string;
}

interface Binding {
	readonly callId: string;
	readonly identity: SubagentIdentity;
}

const sameIdentity = (a: SubagentIdentity, b: SubagentIdentity): boolean => a.agent === b.agent && a.label === b.label;

function named(event: SubagentEvent, identity: SubagentIdentity): SubagentEvent {
	return { ...event, agent: identity.agent, label: identity.label || event.label, role: roleForAgent(identity.agent) };
}

/**
 * Joins a launch (tool input: agent, label) to the task id it produced.
 *
 * Task-mode launches block until the task ends, so the notification for the task usually arrives
 * before the launch result. The first notification for an unknown task therefore claims the oldest
 * launch that has no task id yet. A later launch result that names the task corrects a wrong claim.
 * Pure: the caller publishes the returned events.
 */
export class SubagentIdentityBridge {
	readonly #launches: Launch[] = [];
	readonly #bindings = new Map<string, Binding>();
	readonly #lastEvent = new Map<string, SubagentEvent>();

	/** Feeds Pi tool events. Returns subagent events to publish when a known task gets a corrected identity. */
	piEvent(event: ToolEventLike): SubagentEvent[] {
		if (event.toolName !== SUBAGENT_LAUNCH_TOOL || typeof event.toolCallId !== "string") return [];
		if (event.type === "tool_execution_start") {
			this.#start(event.toolCallId, event.args);
			return [];
		}
		if (event.type === "tool_execution_end") return this.#end(event.toolCallId, event.result);
		return [];
	}

	/** Names a notification-derived event. Unknown tasks with no pending launch stay a generic worker. */
	observe(event: SubagentEvent): SubagentEvent {
		if (event.agent !== UNKNOWN_AGENT) return event;
		if (!this.#bindings.has(event.id)) {
			const launch = this.#launches.find(item => item.taskId === undefined);
			if (launch) this.#bind(launch, event.id);
		}
		const binding = this.#bindings.get(event.id);
		const result = binding ? named(event, binding.identity) : event;
		this.#lastEvent.set(event.id, result);
		if (this.#lastEvent.size > MAX_BINDINGS) this.#lastEvent.delete(this.#lastEvent.keys().next().value as string);
		return result;
	}

	reset(): void {
		this.#launches.length = 0;
		this.#bindings.clear();
		this.#lastEvent.clear();
	}

	#start(callId: string, args: unknown): void {
		const identity = launchIdentityFromArgs(args);
		if (identity === undefined) return;
		this.#launches.push({ callId, identity });
		if (this.#launches.length > MAX_LAUNCHES) this.#launches.shift();
	}

	#end(callId: string, result: unknown): SubagentEvent[] {
		const launch = this.#launches.find(item => item.callId === callId);
		const taskId = taskIdFromLaunchResult(result);
		// No id: the launch stays pending for the next unknown task notification (the fallback).
		if (launch === undefined || taskId === undefined) return [];
		const previous = this.#bindings.get(taskId);
		this.#bind(launch, taskId);
		if (previous !== undefined && sameIdentity(previous.identity, launch.identity)) return [];
		const last = this.#lastEvent.get(taskId);
		return last === undefined ? [] : [named(last, launch.identity)];
	}

	#bind(launch: Launch, taskId: string): void {
		// This launch moved to another task: its old binding no longer holds.
		if (launch.taskId !== undefined && launch.taskId !== taskId && this.#bindings.get(launch.taskId)?.callId === launch.callId) {
			this.#bindings.delete(launch.taskId);
		}
		// The task was claimed by another launch: that launch is free to claim again.
		const holder = this.#bindings.get(taskId);
		if (holder !== undefined && holder.callId !== launch.callId) {
			const other = this.#launches.find(item => item.callId === holder.callId);
			if (other) other.taskId = undefined;
		}
		launch.taskId = taskId;
		this.#bindings.set(taskId, { callId: launch.callId, identity: launch.identity });
		if (this.#bindings.size > MAX_BINDINGS) this.#bindings.delete(this.#bindings.keys().next().value as string);
	}
}
