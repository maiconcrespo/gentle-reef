/**
 * The session's todo list, read from gentle-pi's `todo` tool (T4b): each successful call returns the whole list in
 * `details.gentleTodo`, so the latest result is the current list. Pure: the extension feeds it Pi events and entries.
 */

export type TodoStatus = "pending" | "in_progress" | "blocked" | "done" | "dropped";

export interface TodoTask {
	readonly id: number;
	readonly title: string;
	readonly status: TodoStatus;
}

const STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "blocked", "done", "dropped"]);
const TODO_TOOL = "todo";
const DETAILS_KEY = "gentleTodo";

/** The tasks in a `details` object, or null when it holds no todo list. Tasks without a title or a known status are skipped. */
function fromDetails(details: unknown): TodoTask[] | null {
	const state = (details as Record<string, unknown> | undefined)?.[DETAILS_KEY] as { tasks?: unknown } | undefined;
	if (!state || !Array.isArray(state.tasks)) return null;
	const tasks: TodoTask[] = [];
	for (const raw of state.tasks as Array<Record<string, unknown>>) {
		if (typeof raw?.title !== "string" || typeof raw.status !== "string" || !STATUSES.has(raw.status)) continue;
		tasks.push({ id: typeof raw.id === "number" ? raw.id : tasks.length + 1, title: raw.title, status: raw.status as TodoStatus });
	}
	return tasks;
}

/** The list after a Pi `tool_execution_end` of the todo tool, or null for any other event. */
export function todoFromToolEnd(event: { type: string; toolName?: string; isError?: boolean; result?: { details?: unknown } }): TodoTask[] | null {
	if (event.type !== "tool_execution_end" || event.toolName !== TODO_TOOL || event.isError) return null;
	return fromDetails(event.result?.details);
}

/** The list from the session's entries (resume): the last todo tool result wins; null when there is none. */
export function todoFromEntries(entries: ReadonlyArray<{ type?: string; message?: { role?: string; toolName?: string; isError?: boolean; details?: unknown } }>): TodoTask[] | null {
	let tasks: TodoTask[] | null = null;
	for (const entry of entries) {
		const message = entry.message;
		if (entry.type !== "message" || message?.role !== "toolResult" || message.toolName !== TODO_TOOL || message.isError) continue;
		tasks = fromDetails(message.details) ?? tasks;
	}
	return tasks;
}

/** What PARTY shows as "Doing now": the first in-progress task and done/total, dropped tasks left out; null when none is in progress. */
export function doingNow(tasks: readonly TodoTask[]): { title: string; done: number; total: number } | null {
	const current = tasks.find(task => task.status === "in_progress");
	if (!current) return null;
	const counted = tasks.filter(task => task.status !== "dropped");
	return { title: current.title, done: counted.filter(task => task.status === "done").length, total: counted.length };
}

const BOARD_ROWS = 4;

/** The tasks on the TODO board: from one task before the first open one, dropped tasks skipped, at most `rows`. */
export function boardTasks(tasks: readonly TodoTask[], rows = BOARD_ROWS): TodoTask[] {
	const shown = tasks.filter(task => task.status !== "dropped");
	const open = shown.findIndex(task => task.status !== "done");
	const start = open === -1 ? Math.max(0, shown.length - rows) : Math.max(0, open - 1);
	return shown.slice(start, start + rows);
}

/** The TODO board's rows (web/hq-scene.js draws four), one per task from boardTasks. */
export function boardRows(tasks: readonly TodoTask[]): Array<{ done: boolean; now: boolean }> {
	return boardTasks(tasks).map(task => ({ done: task.status === "done", now: task.status === "in_progress" }));
}
