import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Plain ES module shared with the browser page (web/); the page feeds it contract events and reads its queue.
import {
	AUTO_ADVANCE_MS,
	dwellMs,
	NARRATOR_QUEUE_LIMIT,
	TYPE_MS_PER_CHAR,
	actorOf,
	dialogView,
	initialDialog,
	initialNarrator,
	narrate,
	narrateSnapshot,
	reduceDialog,
	typedLength,
} from "../web/scene-reducer.js";

const ev = (body: Record<string, unknown>) => ({ v: 1, ...body });
const orchestrator = (state: string, toolName?: string) => ev({ type: "orchestrator", state, ...(toolName ? { toolName } : {}) });
const tool = (phase: "start" | "end", toolName: string, extra: Record<string, unknown> = {}) => ev({ type: "tool", actor: "orchestrator", toolName, phase, ...extra });
const agent = (id: string, status: string, extra: Record<string, unknown> = {}) => ev({ type: "subagent", id, agent: "gentle-ai-explore", role: "explore", label: "scout", status, ...extra });

/** Feeds events one by one and returns every line they produced, in order. */
function lines(events: Array<{ event: unknown; at?: number }>, start = initialNarrator()) {
	let state = start;
	const out: Array<{ speaker: string; text: string; tone: string }> = [];
	for (const { event, at = 1_000 } of events) {
		const next = narrate(state, event as never, at);
		state = next.state;
		out.push(...next.lines);
	}
	return out;
}

describe("narrator: orchestrator lines", () => {
	it("a turn that starts narrates thinking once", () => {
		const out = lines([{ event: orchestrator("thinking") }, { event: orchestrator("thinking") }]);
		assert.deepEqual(out, [{ speaker: "ORCHESTRATOR", text: "thinking…", tone: "info" }]);
	});

	it("thinking again after a tool does not repeat the line", () => {
		const out = lines([
			{ event: orchestrator("thinking") },
			{ event: tool("start", "bash") },
			{ event: orchestrator("tool", "bash") },
			{ event: tool("end", "bash", { ok: true }) },
			{ event: orchestrator("thinking") },
		]);
		assert.equal(out.filter(line => line.text === "thinking…").length, 1);
	});

	it("settling back to the floor says the work is done", () => {
		const out = lines([{ event: orchestrator("thinking") }, { event: orchestrator("idle") }]);
		assert.deepEqual(out.at(-1), { speaker: "ORCHESTRATOR", text: "done, back on the floor.", tone: "ok" });
	});

	it("waiting for the user says so and does not depend on an ask prompt", () => {
		const out = lines([{ event: orchestrator("waiting-user", "ask_user_question") }]);
		assert.deepEqual(out, [{ speaker: "ORCHESTRATOR", text: "waiting for your answer.", tone: "ask" }]);
	});
});

describe("narrator: tool lines", () => {
	it("a tool start says what is running", () => {
		const out = lines([{ event: tool("start", "bash") }]);
		assert.deepEqual(out, [{ speaker: "ORCHESTRATOR", text: "running bash…", tone: "info" }]);
	});

	it("a tool end reports the check mark and the duration from its start", () => {
		const out = lines([{ event: tool("start", "bash"), at: 1_000 }, { event: tool("end", "bash", { ok: true }), at: 1_400 }]);
		assert.deepEqual(out.at(-1), { speaker: "ORCHESTRATOR", text: "bash done ✓ · 0.4s", tone: "ok" });
	});

	it("a failed tool end reports the bang and the duration", () => {
		const out = lines([{ event: tool("start", "bash"), at: 0 }, { event: tool("end", "bash", { ok: false }), at: 13_000 }]);
		assert.deepEqual(out.at(-1), { speaker: "ORCHESTRATOR", text: "bash failed ! · 13s", tone: "fail" });
	});

	it("a tool end without a seen start still reports the outcome", () => {
		const out = lines([{ event: tool("end", "bash", { ok: true }) }]);
		assert.deepEqual(out, [{ speaker: "ORCHESTRATOR", text: "bash done ✓", tone: "ok" }]);
	});

	it("an ask_user tool start adds no tool line: the waiting line covers it", () => {
		const out = lines([{ event: tool("start", "ask_user_question") }]);
		assert.deepEqual(out, []);
	});
});

describe("narrator: feature lines", () => {
	it("a memory feature says it is saving to memory", () => {
		const out = lines([{ event: ev({ type: "feature", feature: "memory", detail: "mem_save" }) }]);
		assert.deepEqual(out, [{ speaker: "ORCHESTRATOR", text: "saving to memory…", tone: "info" }]);
	});

	it("a feature without a sentence falls back to a generic line", () => {
		const out = lines([{ event: ev({ type: "feature", feature: "other", detail: "whatever" }) }]);
		assert.deepEqual(out, [{ speaker: "ORCHESTRATOR", text: "using a tool…", tone: "info" }]);
	});
});

describe("narrator: compaction lines", () => {
	it("start, end and failure each narrate once", () => {
		const out = lines([
			{ event: ev({ type: "compaction", phase: "start" }) },
			{ event: ev({ type: "compaction", phase: "end" }) },
			{ event: ev({ type: "compaction", phase: "failed" }) },
		]);
		assert.deepEqual(out.map(line => line.tone), ["coffee", "coffee", "fail"]);
		assert.match(out[0].text, /brewing a fresh pot/);
	});
});

describe("narrator: subagent lines", () => {
	it("arrival names the label and says where the agent stands", () => {
		const out = lines([{ event: agent("a1", "queued") }]);
		assert.deepEqual(out, [{ speaker: "scout", text: "arrived, waiting for a desk.", tone: "info" }]);
	});

	it("starting to type, waiting and finishing each narrate their change", () => {
		const out = lines([
			{ event: agent("a1", "queued") },
			{ event: agent("a1", "running") },
			{ event: agent("a1", "waiting") },
			{ event: agent("a1", "completed") },
		]);
		assert.deepEqual(out.slice(1).map(line => line.text), ["starts typing…", "waiting for a reply.", "finished ✓"]);
		assert.equal(out.at(-1)?.tone, "ok");
	});

	it("failure, cancellation and timeout use the bang", () => {
		const failed = lines([{ event: agent("a1", "running") }, { event: agent("a1", "failed") }]).at(-1);
		const cancelled = lines([{ event: agent("a2", "running") }, { event: agent("a2", "cancelled") }]).at(-1);
		const timedOut = lines([{ event: agent("a3", "running") }, { event: agent("a3", "timed_out") }]).at(-1);
		assert.deepEqual(failed, { speaker: "scout", text: "failed !", tone: "fail" });
		assert.deepEqual(cancelled, { speaker: "scout", text: "cancelled !", tone: "fail" });
		assert.deepEqual(timedOut, { speaker: "scout", text: "timed out !", tone: "fail" });
	});

	it("the same status twice narrates nothing", () => {
		const out = lines([{ event: agent("a1", "running") }, { event: agent("a1", "running") }]);
		assert.equal(out.length, 1);
	});

	it("a snapshot that already shows an agent does not replay its arrival", () => {
		const snapshot = { v: 1, orchestrator: { state: "tool" }, context: { percent: 10 }, compaction: null, agents: [{ id: "a1", agent: "gentle-ai-explore", role: "explore", label: "scout", status: "running" }] };
		const synced = narrateSnapshot(initialNarrator(), snapshot as never);
		const out = narrate(synced, agent("a1", "running") as never, 1_000).lines;
		assert.deepEqual(out, []);
	});
});

describe("narrator: which actor the camera follows", () => {
	it("the orchestrator's own events point at the orchestrator", () => {
		assert.deepEqual(actorOf(orchestrator("thinking") as never), { kind: "orchestrator" });
		assert.deepEqual(actorOf(tool("start", "bash") as never), { kind: "orchestrator" });
		assert.deepEqual(actorOf(ev({ type: "compaction", phase: "start" }) as never), { kind: "orchestrator" });
	});

	it("a subagent event points at that resident, and a feature at its prop", () => {
		assert.deepEqual(actorOf(agent("a7", "running") as never), { kind: "resident", id: "a7" });
		assert.deepEqual(actorOf(ev({ type: "feature", feature: "web", detail: "web_search" }) as never), { kind: "feature", feature: "web" });
	});

	it("context and ask events do not move the camera", () => {
		assert.equal(actorOf(ev({ type: "context", percent: 40 }) as never), null);
		assert.equal(actorOf(ev({ type: "ask", phase: "close" }) as never), null);
	});
});

describe("dialog queue: one line at a time, in order", () => {
	const line = (text: string) => ({ speaker: "ORCHESTRATOR", text, tone: "info" });

	it("the first line is current at once and later lines wait in the queue", () => {
		let state = reduceDialog(initialDialog(), { type: "lines", lines: [line("one"), line("two")] });
		assert.equal(dialogView(state).line?.text, "one");
		assert.equal(dialogView(state).pending, 1);
		state = reduceDialog(state, { type: "next" });
		assert.equal(dialogView(state).line?.text, "two");
		assert.equal(dialogView(state).pending, 0);
	});

	it("next with an empty queue keeps the last line on screen, like a game text box", () => {
		let state = reduceDialog(initialDialog(), { type: "lines", lines: [line("only")] });
		state = reduceDialog(state, { type: "next" });
		assert.equal(dialogView(state).line?.text, "only");
	});

	it("each line gets its own id so the page can restart the typewriter", () => {
		let state = reduceDialog(initialDialog(), { type: "lines", lines: [line("one")] });
		const first = dialogView(state).line!.id;
		state = reduceDialog(state, { type: "lines", lines: [line("two")] });
		state = reduceDialog(state, { type: "next" });
		assert.notEqual(dialogView(state).line!.id, first);
	});

	it("the queue keeps the newest pending lines when it overflows", () => {
		const many = Array.from({ length: NARRATOR_QUEUE_LIMIT + 5 }, (_, i) => line(`line ${i}`));
		const state = reduceDialog(initialDialog(), { type: "lines", lines: many });
		assert.equal(dialogView(state).line?.text, "line 0");
		assert.equal(dialogView(state).pending, NARRATOR_QUEUE_LIMIT);
		let last = state;
		for (let i = 0; i < NARRATOR_QUEUE_LIMIT; i++) last = reduceDialog(last, { type: "next" });
		assert.equal(dialogView(last).line?.text, `line ${NARRATOR_QUEUE_LIMIT + 4}`);
	});
});

describe("dialog priority: an open ask prompt wins over narration", () => {
	const line = (text: string) => ({ speaker: "ORCHESTRATOR", text, tone: "info" });

	it("while the ask is open the view is the ask, and narration keeps queueing", () => {
		let state = reduceDialog(initialDialog(), { type: "ask", open: true });
		state = reduceDialog(state, { type: "lines", lines: [line("one"), line("two")] });
		assert.equal(dialogView(state).mode, "ask");
		assert.equal(dialogView(state).pending, 1, "line one is up next, line two waits behind it");
		state = reduceDialog(state, { type: "lines", lines: [line("three")] });
		assert.equal(dialogView(state).pending, 2, "new lines keep arriving while the ask holds the box");
	});

	it("when the ask closes the narration resumes where it was", () => {
		let state = reduceDialog(initialDialog(), { type: "lines", lines: [line("one"), line("two")] });
		state = reduceDialog(state, { type: "ask", open: true });
		state = reduceDialog(state, { type: "ask", open: false });
		assert.equal(dialogView(state).mode, "line");
		assert.equal(dialogView(state).line?.text, "one");
	});

	it("with nothing to say and no ask the view is empty", () => {
		assert.equal(dialogView(initialDialog()).mode, "none");
	});
});

describe("typewriter timing", () => {
	it("reveals one character per tick, never more than the text", () => {
		assert.equal(typedLength("hello", 0, false), 0);
		assert.equal(typedLength("hello", TYPE_MS_PER_CHAR * 2, false), 2);
		assert.equal(typedLength("hello", 10_000, false), 5);
		assert.equal(typedLength("hello", -50, false), 0);
	});

	it("reduced motion shows the whole line at once", () => {
		assert.equal(typedLength("hello", 0, true), 5);
	});

	it("auto advance waits a short, fixed pause after the line is complete", () => {
		assert.ok(AUTO_ADVANCE_MS >= 1_500 && AUTO_ADVANCE_MS <= 4_000);
	});
});

describe("dialog pacing: the box keeps up when lines back up", () => {
	it("a line with nothing behind it keeps the full pause", () => {
		assert.equal(dwellMs(0), AUTO_ADVANCE_MS);
		assert.equal(dwellMs(1), AUTO_ADVANCE_MS);
	});

	it("a backlog of three or more lines moves on faster, so the box does not trail the events", () => {
		assert.ok(dwellMs(3) < AUTO_ADVANCE_MS);
		assert.ok(dwellMs(NARRATOR_QUEUE_LIMIT) >= 400, "still long enough to read");
	});
});

describe("narrator: a claimant walks back to the coffee (S16)", () => {
	const finish = (state: ReturnType<typeof initialNarrator>, status: string, claimant: boolean, role = "explore") =>
		narrate(state, agent("t1", status, { role, label: "scout" }), 0, { claimant });

	it("a claimant that finishes says it is finished, then narrates the break", () => {
		const started = narrate(initialNarrator(), agent("t1", "running", { label: "scout" }), 0).state;
		assert.deepEqual(finish(started, "completed", true).lines, [
			{ speaker: "scout", text: "finished ✓", tone: "ok" },
			{ speaker: "EXPLORE", text: "back to the coffee.", tone: "info" },
		]);
	});

	it("a claimant that fails walks back too", () => {
		const started = narrate(initialNarrator(), agent("t1", "running", { label: "scout" }), 0).state;
		assert.deepEqual(finish(started, "failed", true, "verify").lines.map((line) => line.speaker), ["scout", "VERIFY"]);
	});

	it("an extra that finishes leaves by the door with no break line", () => {
		const started = narrate(initialNarrator(), agent("t1", "running", { label: "scout" }), 0).state;
		assert.deepEqual(finish(started, "completed", false).lines.map((line) => line.speaker), ["scout"]);
	});

	it("a repeated finish does not repeat the break line", () => {
		const started = narrate(initialNarrator(), agent("t1", "running", { label: "scout" }), 0).state;
		const done = finish(started, "completed", true).state;
		assert.deepEqual(finish(done, "completed", true).lines, []);
	});
});
