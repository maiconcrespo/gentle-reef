import { featureForTool } from "../contract/classify.ts";
import { OFFICE_EVENT_VERSION, type AskQuestion, type OfficeEvent, type OrchestratorState } from "../contract/office-event.ts";

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
// Bounds for the dialog: the args come from the model, the window only needs a readable prompt.
const MAX_ASK_QUESTIONS = 4;
const MAX_ASK_OPTIONS = 4;
const MAX_ASK_TEXT = 300;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function askText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	if (text === "") return undefined;
	return text.length > MAX_ASK_TEXT ? `${text.slice(0, MAX_ASK_TEXT - 1)}…` : text;
}

function askQuestion(raw: unknown): AskQuestion | undefined {
	if (!isRecord(raw)) return undefined;
	const question = askText(raw.question);
	if (question === undefined) return undefined;
	const options = (Array.isArray(raw.options) ? raw.options : [])
		.map(option => (isRecord(option) ? askText(option.label) : undefined))
		.filter((label): label is string => label !== undefined)
		.slice(0, MAX_ASK_OPTIONS);
	const header = askText(raw.header);
	const multiSelect = raw.multiSelect === true;
	const base = header === undefined ? { question, options, multiSelect } : { header, question, options, multiSelect };
	return raw.allowCustomResponse === true ? { ...base, custom: true } : base;
}

/** ask_user_question carries `questions`; ask_user_choice is a single question at the top level. */
function askQuestions(args: unknown): AskQuestion[] {
	if (!isRecord(args)) return [];
	const raw = Array.isArray(args.questions) ? args.questions : [args];
	return raw
		.map(askQuestion)
		.filter((question): question is AskQuestion => question !== undefined)
		.slice(0, MAX_ASK_QUESTIONS);
}

// Review bounds: the args and results come from the model and from review output (which can carry whole diffs).
const REVIEW_TOOL = "gentle_review";
const REVIEW_CAPTURE_TOOLS: ReadonlySet<string> = new Set(["gentle_review_capture", "gentle_review_capture_group"]);
// The lens names gentle-pi's review start accepts. Anything else in the start input is ignored.
const REVIEW_LENS_NAMES: ReadonlySet<string> = new Set(["risk", "resilience", "readability", "reliability"]);
const MAX_REVIEW_LENSES = 4;
const MAX_REVIEW_INPUT = 8_000;
const MAX_REVIEW_TEXT = 20_000;
// Markers gentle-pi writes into review results (the forecast runs nothing, so it is never a verdict).
const FORECAST_MARKER = "reviewer-model-run-forecast";
const ACKNOWLEDGED_MARKER = "native-approved-acknowledgement-completed";
const CORRECTION_MARKER = "correction_required";
const APPROVED_STATE = /"state"\s*:\s*"approved"/;

const jsonText = (value: unknown): string => {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
};

/** The text a tool result carries: its text parts and its details, each bounded. Unknown shapes give "". */
function resultText(result: unknown): string {
	if (typeof result === "string") return result.slice(0, MAX_REVIEW_TEXT);
	if (!isRecord(result)) return "";
	const parts = Array.isArray(result.content) ? result.content : [];
	const texts = parts.flatMap(part => (isRecord(part) && typeof part.text === "string" ? [part.text.slice(0, MAX_REVIEW_TEXT)] : []));
	return [...texts, jsonText(result.details).slice(0, MAX_REVIEW_TEXT)].join("\n");
}

function reviewLenses(input: unknown): string[] {
	let value: unknown = input;
	if (typeof input === "string") {
		if (input.length > MAX_REVIEW_INPUT) return [];
		try {
			value = JSON.parse(input);
		} catch {
			return [];
		}
	}
	if (!isRecord(value) || !Array.isArray(value.lenses)) return [];
	const names = value.lenses.filter((lens): lens is string => typeof lens === "string" && REVIEW_LENS_NAMES.has(lens));
	return [...new Set(names)].slice(0, MAX_REVIEW_LENSES);
}

/** A review start: `gentle_review` start or inspect arrives; a capture inspects only when it runs (acknowledged). */
function reviewStart(toolName: string, args: unknown): OfficeEvent | undefined {
	if (!isRecord(args)) return undefined;
	if (toolName === REVIEW_TOOL) {
		if (args.operation !== "start" && args.operation !== "inspect") return undefined;
		const names = reviewLenses(args.input);
		return names.length > 0
			? { v: OFFICE_EVENT_VERSION, type: "review", phase: "arrive", names }
			: { v: OFFICE_EVENT_VERSION, type: "review", phase: "arrive" };
	}
	if (!REVIEW_CAPTURE_TOOLS.has(toolName) || args.reviewerRunAcknowledged !== true) return undefined;
	// A single capture runs one lens; a group runs one per binding.
	const bindings = toolName === "gentle_review_capture" ? 1 : Array.isArray(args.collectBindings) ? args.collectBindings.length : 0;
	const count = Math.min(bindings, MAX_REVIEW_LENSES);
	return count > 0 ? { v: OFFICE_EVENT_VERSION, type: "review", phase: "inspect", count } : undefined;
}

/** A review end: a capture's verdict from its result, or the acknowledgement that completed. Unknown shapes give nothing. */
function reviewEnd(toolName: string, isError: boolean, result: unknown): OfficeEvent | undefined {
	// Only review tools read their result, so other tools never pay for serializing it.
	if (toolName !== REVIEW_TOOL && !REVIEW_CAPTURE_TOOLS.has(toolName)) return undefined;
	const text = resultText(result);
	if (toolName === REVIEW_TOOL) {
		return !isError && text.includes(ACKNOWLEDGED_MARKER) ? { v: OFFICE_EVENT_VERSION, type: "review", phase: "acknowledged" } : undefined;
	}
	if (text.includes(FORECAST_MARKER)) return undefined;
	const verdict = isError ? "failed" : text.includes(CORRECTION_MARKER) ? "correction" : APPROVED_STATE.test(text) ? "approved" : undefined;
	return verdict === undefined ? undefined : { v: OFFICE_EVENT_VERSION, type: "review", phase: "verdict", verdict };
}

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
			if (event.toolName.startsWith(ASK_TOOL_PREFIX)) {
				const questions = askQuestions(event.args);
				if (questions.length > 0) out.push({ v: OFFICE_EVENT_VERSION, type: "ask", phase: "open", questions });
			}
			const review = reviewStart(event.toolName, event.args);
			if (review) out.push(review);
			return out;
		}
		case "tool_execution_end": {
			const out: OfficeEvent[] = [
				{ v: OFFICE_EVENT_VERSION, type: "tool", actor: "orchestrator", toolName: event.toolName, phase: "end", ok: !event.isError },
				orchestrator("thinking"),
			];
			if (event.toolName.startsWith(ASK_TOOL_PREFIX)) out.push({ v: OFFICE_EVENT_VERSION, type: "ask", phase: "close" });
			const review = reviewEnd(event.toolName, event.isError, event.result);
			if (review) out.push(review);
			return out;
		}
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
