import type { Feature, Role } from "./office-event.ts";

export const OFFICE_FEATURES: readonly Feature[] = ["music", "design", "memory", "web", "todo", "ask", "review", "judgment", "mcp", "codegraph", "other"];

// A Map, not a record: an object lookup would answer for keys like "constructor".
const ROLE_BY_AGENT: ReadonlyMap<string, Role> = new Map([
	["gentle-ai-explore", "explore"],
	["gentle-ai-worker", "worker"],
	["worker", "worker"],
	["gentle-ai-verify", "verify"],
	["jd-fix-agent", "worker"],
]);

export function roleForAgent(agent: string | undefined): Role {
	if (agent === undefined) return "worker";
	const exact = ROLE_BY_AGENT.get(agent);
	if (exact) return exact;
	if (agent.startsWith("review-")) return "inspector";
	if (agent.startsWith("jd-judge-")) return "judge";
	return "worker";
}

const TOOL_FEATURES: ReadonlyArray<readonly [(name: string) => boolean, Feature]> = [
	[name => name.startsWith("mem_"), "memory"],
	[name => name.startsWith("web_search") || name === "fetch_content", "web"],
	[name => name.startsWith("gentle_design"), "design"],
	[name => name === "todo" || name.startsWith("todo_"), "todo"],
	[name => name.startsWith("ask_user"), "ask"],
	[name => name.startsWith("gentle_review"), "review"],
	[name => name.includes("codegraph"), "codegraph"],
	[name => name === "mcp", "mcp"],
	// Not in the spec's tool list; a guess from the gentle-stream naming. Verify before T6.
	[name => name.startsWith("gentle_stream") || name.includes("music"), "music"],
];

export function featureForTool(toolName: string): Feature | undefined {
	return TOOL_FEATURES.find(([matches]) => matches(toolName))?.[1];
}

export function featureForAgent(agent: string): Feature | undefined {
	if (agent.startsWith("jd-judge-")) return "judgment";
	if (agent.startsWith("review-")) return "review";
	return undefined;
}
