import { roleForAgent } from "../contract/classify.ts";
import {
	OFFICE_EVENT_VERSION,
	type AskQuestion,
	type CompactionPhase,
	type OfficeEvent,
	type OfficeTaskStatus,
	type OrchestratorState,
	type ReviewEvent,
	type SubagentEvent,
} from "../contract/office-event.ts";

export const DEFAULT_HUB_CAPACITY = 200;
/** Finished agents beyond this are evicted; active agents are never evicted. */
const MAX_TRACKED_AGENTS = 64;
const UNKNOWN_AGENT = "unknown";
const ACTIVE_STATUSES: ReadonlySet<OfficeTaskStatus> = new Set(["queued", "running", "waiting"]);

export interface OfficeEnvelope {
	readonly seq: number;
	readonly event: OfficeEvent;
}

export interface OfficeSnapshot {
	readonly v: typeof OFFICE_EVENT_VERSION;
	readonly orchestrator: { readonly state: OrchestratorState; readonly toolName?: string };
	readonly context: { readonly percent: number | null };
	readonly compaction: CompactionPhase | null;
	readonly agents: readonly SubagentEvent[];
	/** The ask_user prompt waiting for the user, or null. */
	readonly ask: { readonly questions: readonly AskQuestion[] } | null;
	/** The native review on the reviewer desks: the lenses its start asked for and how many a capture runs. */
	readonly review: ReviewView;
}

/** `arriving` after a start, `inspecting` while a capture runs, `approved` until the sign-off; `idle` otherwise. */
export interface ReviewView {
	readonly phase: "idle" | "arriving" | "inspecting" | "approved";
	readonly lenses: readonly string[];
	readonly count: number;
}

const NO_REVIEW: ReviewView = { phase: "idle", lenses: [], count: 0 };

export interface HubStats {
	readonly subscribers: number;
	readonly published: number;
	readonly buffered: number;
	readonly dropped: number;
	readonly capacity: number;
	readonly listenerErrors: number;
}

export type OfficeListener = (envelope: OfficeEnvelope) => void;

interface OrchestratorView {
	state: OrchestratorState;
	toolName?: string;
}

/**
 * In-memory hub: bounded ring buffer of recent envelopes, live subscribers,
 * and a snapshot a late subscriber can sync from. Pure; no I/O.
 */
export class OfficeHub {
	readonly #capacity: number;
	readonly #buffer: OfficeEnvelope[] = [];
	readonly #listeners = new Set<OfficeListener>();
	readonly #agents = new Map<string, SubagentEvent>();
	#orchestrator: OrchestratorView = { state: "idle" };
	#context: { percent: number | null } = { percent: null };
	#compaction: CompactionPhase | null = null;
	#ask: { questions: readonly AskQuestion[] } | null = null;
	#review: ReviewView = NO_REVIEW;
	#seq = 0;
	#dropped = 0;
	#listenerErrors = 0;

	constructor(options: { capacity?: number } = {}) {
		this.#capacity = Math.max(1, options.capacity ?? DEFAULT_HUB_CAPACITY);
	}

	publish(event: OfficeEvent): OfficeEnvelope {
		const envelope: OfficeEnvelope = Object.freeze({ seq: ++this.#seq, event });
		this.#buffer.push(envelope);
		if (this.#buffer.length > this.#capacity) {
			this.#buffer.shift();
			this.#dropped++;
		}
		this.#apply(event);
		for (const listener of [...this.#listeners]) {
			try {
				listener(envelope);
			} catch {
				// A broken window must not break Pi or the other listeners.
				this.#listenerErrors++;
			}
		}
		return envelope;
	}

	subscribe(listener: OfficeListener): () => void {
		this.#listeners.add(listener);
		return () => { this.#listeners.delete(listener); };
	}

	recent(): OfficeEnvelope[] {
		return [...this.#buffer];
	}

	snapshot(): OfficeSnapshot {
		return {
			v: OFFICE_EVENT_VERSION,
			orchestrator: { ...this.#orchestrator },
			context: { ...this.#context },
			compaction: this.#compaction,
			agents: [...this.#agents.values()].map(agent => ({ ...agent })),
			ask: this.#ask === null ? null : { questions: this.#ask.questions.map(question => ({ ...question })) },
			review: { ...this.#review, lenses: [...this.#review.lenses] },
		};
	}

	stats(): HubStats {
		return {
			subscribers: this.#listeners.size,
			published: this.#seq,
			buffered: this.#buffer.length,
			dropped: this.#dropped,
			capacity: this.#capacity,
			listenerErrors: this.#listenerErrors,
		};
	}

	/** Clears buffer and snapshot. Sequence numbers keep increasing so old ids never repeat. */
	reset(): void {
		this.#buffer.length = 0;
		this.#agents.clear();
		this.#orchestrator = { state: "idle" };
		this.#context = { percent: null };
		this.#compaction = null;
		this.#ask = null;
		this.#review = NO_REVIEW;
	}

	#apply(event: OfficeEvent): void {
		switch (event.type) {
			case "orchestrator":
				// The session went idle: nobody stays at the reviewer desks.
				if (event.state === "idle") this.#review = NO_REVIEW;
				this.#orchestrator = event.toolName === undefined ? { state: event.state } : { state: event.state, toolName: event.toolName };
				return;
			case "context":
				this.#context = { percent: event.percent };
				return;
			case "compaction":
				this.#compaction = event.phase;
				// Pi reports no usage right after compaction; the pre-compaction reading is no longer true.
				if (event.phase === "end") this.#context = { percent: null };
				return;
			case "subagent":
				this.#upsertAgent(event);
				return;
			case "ask":
				this.#ask = event.phase === "open" ? { questions: event.questions } : null;
				return;
			case "review":
				this.#review = nextReview(this.#review, event);
				return;
			default:
				return;
		}
	}

	#upsertAgent(event: SubagentEvent): void {
		const previous = this.#agents.get(event.id);
		// A status-only notification must not erase what an earlier event learned about the agent.
		const agent = event.agent === UNKNOWN_AGENT && previous ? previous.agent : event.agent;
		const label = event.label === "" && previous ? previous.label : event.label;
		this.#agents.set(event.id, { ...previous, ...event, agent, label, role: roleForAgent(agent) });
		for (const [id, candidate] of this.#agents) {
			if (this.#agents.size <= MAX_TRACKED_AGENTS) break;
			if (!ACTIVE_STATUSES.has(candidate.status)) this.#agents.delete(id);
		}
	}
}

/** One verdict per capture: an approval waits for the sign-off, a correction or a failure ends the review. */
function nextReview(current: ReviewView, event: ReviewEvent): ReviewView {
	switch (event.phase) {
		case "arrive":
			return { phase: "arriving", lenses: [...(event.names ?? [])], count: 0 };
		case "inspect":
			return { phase: "inspecting", lenses: current.lenses, count: event.count };
		case "verdict":
			if (current.phase === "idle") return current;
			return event.verdict === "approved" ? { ...current, phase: "approved" } : NO_REVIEW;
		case "acknowledged":
			return NO_REVIEW;
	}
}
