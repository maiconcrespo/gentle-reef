import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardRows, doingNow, todoFromEntries, todoFromToolEnd } from "../src/stage/todo.ts";

const task = (id: number, status: string, title = `task ${id}`) => ({ id, title, status });
const state = (...tasks: ReturnType<typeof task>[]) => ({ gentleTodo: { tasks, nextId: tasks.length + 1, updatedTurn: 1 } });

describe("the todo list from gentle-pi's todo tool (T4b)", () => {
	it("reads the tasks from a todo tool result's details.gentleTodo", () => {
		const tasks = todoFromToolEnd({ type: "tool_execution_end", toolName: "todo", result: { details: state(task(1, "done"), task(2, "in_progress")) } });
		assert.deepEqual(tasks, [{ id: 1, title: "task 1", status: "done" }, { id: 2, title: "task 2", status: "in_progress" }]);
	});

	it("ignores other tools, failed calls and malformed details", () => {
		assert.equal(todoFromToolEnd({ type: "tool_execution_end", toolName: "bash", result: { details: state(task(1, "done")) } }), null);
		assert.equal(todoFromToolEnd({ type: "tool_execution_end", toolName: "todo", isError: true, result: { details: state(task(1, "done")) } }), null);
		assert.equal(todoFromToolEnd({ type: "tool_execution_end", toolName: "todo", result: { details: { gentleTodo: { tasks: "x" } } } }), null);
		assert.equal(todoFromToolEnd({ type: "tool_execution_end", toolName: "todo" }), null);
		assert.equal(todoFromToolEnd({ type: "tool_execution_start", toolName: "todo", result: { details: state(task(1, "done")) } }), null);
	});

	it("skips tasks without a title or a known status", () => {
		const tasks = todoFromToolEnd({ type: "tool_execution_end", toolName: "todo", result: { details: { gentleTodo: { tasks: [task(1, "done"), { id: 2, status: "done" }, task(3, "weird")] } } } });
		assert.deepEqual(tasks, [{ id: 1, title: "task 1", status: "done" }]);
	});

	it("rebuilds the list from the session's entries: the last todo result wins", () => {
		const entry = (toolName: string, details: unknown) => ({ type: "message", message: { role: "toolResult", toolName, details } });
		const tasks = todoFromEntries([entry("todo", state(task(1, "pending"))), entry("bash", {}), entry("todo", state(task(1, "done"), task(2, "pending"))), { type: "custom" }]);
		assert.deepEqual(tasks?.map(t => t.status), ["done", "pending"]);
		assert.equal(todoFromEntries([entry("bash", {})]), null);
	});

	it("Doing now: the first in-progress task and done/total without dropped tasks; null when nothing is in progress", () => {
		assert.deepEqual(doingNow([task(1, "done"), task(2, "in_progress", "Write the parser"), task(3, "dropped"), task(4, "pending")]), { title: "Write the parser", done: 1, total: 3 });
		assert.equal(doingNow([task(1, "done"), task(2, "pending")]), null);
		assert.equal(doingNow([]), null);
	});

	it("the chalkboard's four TODO rows start one before the first open task and skip dropped ones", () => {
		const rows = boardRows([task(1, "done"), task(2, "done"), task(3, "dropped"), task(4, "in_progress"), task(5, "pending"), task(6, "blocked"), task(7, "pending")]);
		assert.deepEqual(rows, [{ done: true, now: false }, { done: false, now: true }, { done: false, now: false }, { done: false, now: false }]);
		assert.deepEqual(boardRows([task(1, "done"), task(2, "done")]), [{ done: true, now: false }, { done: true, now: false }]);
		assert.deepEqual(boardRows([]), []);
	});
});
