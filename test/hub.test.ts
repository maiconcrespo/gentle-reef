import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OfficeHub } from "../src/adapter/hub.ts";
import type { OfficeEvent } from "../src/contract/office-event.ts";

const thinking: OfficeEvent = { v: 1, type: "orchestrator", state: "thinking" };
const context = (percent: number): OfficeEvent => ({ v: 1, type: "context", percent });
const agent = (id: string, status: "running" | "completed", extra: Partial<OfficeEvent> = {}): OfficeEvent =>
	({ v: 1, type: "subagent", id, agent: "gentle-ai-worker", role: "worker", label: "job", status, ...extra }) as OfficeEvent;

describe("OfficeHub ring buffer", () => {
	it("keeps only the newest capacity envelopes and counts what it dropped", () => {
		const hub = new OfficeHub({ capacity: 10 });
		for (let i = 0; i < 500; i++) hub.publish(context(i % 100));
		const recent = hub.recent();
		assert.equal(recent.length, 10);
		assert.equal(recent[0].seq, 491);
		assert.equal(recent[9].seq, 500);
		assert.deepEqual(hub.stats(), { subscribers: 0, published: 500, buffered: 10, dropped: 490, capacity: 10, listenerErrors: 0 });
	});
});

describe("OfficeHub snapshot", () => {
	it("reflects orchestrator state, context usage and compaction", () => {
		const hub = new OfficeHub();
		hub.publish(thinking);
		hub.publish({ v: 1, type: "orchestrator", state: "tool", toolName: "bash" });
		hub.publish(context(30));
		hub.publish({ v: 1, type: "compaction", phase: "start" });
		assert.deepEqual(hub.snapshot(), {
			v: 1,
			orchestrator: { state: "tool", toolName: "bash" },
			context: { percent: 30 },
			compaction: "start",
			agents: [],
		});
	});

	it("keeps the known agent identity when a status-only notification arrives", () => {
		const hub = new OfficeHub();
		hub.publish(agent("t1", "running", { agent: "gentle-ai-explore", role: "explore", label: "map repo", tokens: 500 } as Partial<OfficeEvent>));
		hub.publish({ v: 1, type: "subagent", id: "t1", agent: "unknown", role: "worker", label: "", status: "completed" });
		assert.deepEqual(hub.snapshot().agents, [
			{ v: 1, type: "subagent", id: "t1", agent: "gentle-ai-explore", role: "explore", label: "map repo", status: "completed", tokens: 500 },
		]);
	});

	it("evicts finished agents past the cap but keeps active ones", () => {
		const hub = new OfficeHub();
		hub.publish(agent("active", "running"));
		for (let i = 0; i < 70; i++) hub.publish(agent(`done-${i}`, "completed"));
		const ids = hub.snapshot().agents.map(a => a.id);
		assert.equal(ids.length, 64);
		assert.ok(ids.includes("active"));
		assert.ok(!ids.includes("done-0"));
	});
});

describe("OfficeHub subscribers", () => {
	it("delivers only events published after subscribing; a late subscriber syncs from snapshot and recent", () => {
		const hub = new OfficeHub();
		hub.publish(thinking);
		hub.publish(context(10));
		const seen: number[] = [];
		hub.subscribe(envelope => seen.push(envelope.seq));
		hub.publish({ v: 1, type: "orchestrator", state: "idle" });
		assert.deepEqual(seen, [3]);
		assert.equal(hub.snapshot().orchestrator.state, "idle");
		assert.deepEqual(hub.recent().map(e => e.seq), [1, 2, 3]);
	});

	it("stops delivery after unsubscribe", () => {
		const hub = new OfficeHub();
		const seen: number[] = [];
		const off = hub.subscribe(envelope => seen.push(envelope.seq));
		hub.publish(thinking);
		off();
		hub.publish(thinking);
		assert.deepEqual(seen, [1]);
		assert.equal(hub.stats().subscribers, 0);
	});

	it("isolates a throwing listener from the publisher and the other listeners", () => {
		const hub = new OfficeHub();
		const seen: number[] = [];
		hub.subscribe(() => { throw new Error("broken window"); });
		hub.subscribe(envelope => seen.push(envelope.seq));
		assert.doesNotThrow(() => hub.publish(thinking));
		assert.deepEqual(seen, [1]);
		assert.equal(hub.stats().listenerErrors, 1);
	});

	it("reset clears the buffer and snapshot but keeps sequence numbers increasing", () => {
		const hub = new OfficeHub();
		hub.publish(thinking);
		hub.reset();
		assert.equal(hub.stats().buffered, 0);
		assert.equal(hub.snapshot().orchestrator.state, "idle");
		assert.equal(hub.publish(thinking).seq, 2);
	});
});

describe("OfficeHub compaction", () => {
	it("forgets the stale usage reading when compaction ends, so the snapshot does not show pre-compaction usage", () => {
		const hub = new OfficeHub();
		hub.publish(context(90));
		hub.publish({ v: 1, type: "compaction", phase: "start" });
		hub.publish({ v: 1, type: "compaction", phase: "end" });
		assert.deepEqual(hub.snapshot().context, { percent: null });
		assert.equal(hub.snapshot().compaction, "end");
	});
});
