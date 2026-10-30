import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Plain ES module shared with the browser page (web/); no build step, so Node loads it directly.
import { DESK_COUNT, initialScene, reduceScene, sceneView } from "../web/scene-reducer.js";

type Scene = ReturnType<typeof initialScene>;

const at = 1_000;
const sub = (id: string, agent: string, status: string, label = "job") => ({
	type: "event",
	seq: 1,
	at,
	event: { v: 1, type: "subagent", id, agent, role: roleOf(agent), label, status },
});
const departed = (id: string) => ({ type: "departed", id });
const snapshot = (agents: Array<Record<string, unknown>>) => ({
	type: "snapshot",
	at,
	snapshot: { v: 1, orchestrator: { state: "idle" }, context: { percent: null }, compaction: null, agents },
});

function roleOf(agent: string): string {
	if (agent === "gentle-ai-explore") return "explore";
	if (agent === "gentle-ai-verify") return "verify";
	if (agent.startsWith("review-")) return "inspector";
	if (agent.startsWith("jd-judge-")) return "judge";
	return "worker";
}

function run(...actions: unknown[]): Scene {
	return actions.reduce<Scene>((state, action) => reduceScene(state, action as never), initialScene());
}

const seatOf = (state: Scene, id: string) => sceneView(state).agents.find((agent: { id: string }) => agent.id === id)?.seat;

describe("desk assignment", () => {
	it("has as many desks as the zone draws", () => {
		assert.equal(DESK_COUNT, 4);
		assert.equal(initialScene().seats.desks.length, 4);
	});

	it("gives each running resident the first free desk, in arrival order", () => {
		const state = run(sub("t1", "gentle-ai-explore", "running"), sub("t2", "gentle-ai-worker", "running"), sub("t3", "gentle-ai-verify", "running"));
		assert.deepEqual(seatOf(state, "t1"), { zone: "desk", index: 0 });
		assert.deepEqual(seatOf(state, "t2"), { zone: "desk", index: 1 });
		// A verify agent takes the verify corner, not the pod (S17), so the pod's third desk stays for the next resident.
		assert.deepEqual(seatOf(state, "t3"), { zone: "verify", index: 0 });
	});

	it("keeps the same desk when the status changes", () => {
		const state = run(sub("t1", "gentle-ai-worker", "running"), sub("t2", "gentle-ai-worker", "running"), sub("t2", "gentle-ai-worker", "waiting"));
		assert.deepEqual(seatOf(state, "t2"), { zone: "desk", index: 1 });
	});

	it("queues the fifth agent on the bench and seats it when a desk is released", () => {
		let state = run(
			sub("t1", "gentle-ai-explore", "running"),
			sub("t2", "gentle-ai-worker", "running"),
			sub("t3", "gentle-ai-worker", "running"),
			sub("t4", "gentle-ai-worker", "running"),
			sub("t5", "gentle-ai-worker", "running"),
		);
		assert.deepEqual(seatOf(state, "t5"), { zone: "bench", index: 0 });
		state = run(
			sub("t1", "gentle-ai-explore", "running"),
			sub("t2", "gentle-ai-worker", "running"),
			sub("t3", "gentle-ai-worker", "running"),
			sub("t4", "gentle-ai-worker", "running"),
			sub("t5", "gentle-ai-worker", "running"),
			sub("t1", "gentle-ai-explore", "completed"),
			departed("t1"),
		);
		assert.deepEqual(seatOf(state, "t5"), { zone: "desk", index: 0 });
		assert.equal(seatOf(state, "t1"), undefined, "the departed agent no longer has a seat");
	});

	it("a completed agent keeps its desk until it has left, so two sprites never share a chair", () => {
		const state = run(sub("t1", "gentle-ai-worker", "running"), sub("t1", "gentle-ai-worker", "completed"), sub("t2", "gentle-ai-worker", "running"));
		assert.deepEqual(seatOf(state, "t1"), { zone: "desk", index: 0 });
		assert.deepEqual(seatOf(state, "t2"), { zone: "desk", index: 1 });
		assert.equal(sceneView(state).agents.find((agent: { id: string }) => agent.id === "t1").leaving, true);
	});

	it("a queued agent waits on the bench even when a desk is free", () => {
		const state = run(sub("t1", "gentle-ai-worker", "queued"));
		assert.deepEqual(seatOf(state, "t1"), { zone: "bench", index: 0 });
	});

	it("a bench agent that starts running takes a free desk", () => {
		const state = run(sub("t1", "gentle-ai-worker", "running"), sub("t2", "gentle-ai-worker", "queued"), sub("t2", "gentle-ai-worker", "running"));
		assert.deepEqual(seatOf(state, "t2"), { zone: "desk", index: 1 });
	});

	it("promotion skips queued and finished bench entries", () => {
		const state = run(
			sub("t1", "gentle-ai-worker", "running"),
			sub("t2", "gentle-ai-worker", "running"),
			sub("t3", "gentle-ai-worker", "running"),
			sub("t4", "gentle-ai-worker", "running"),
			sub("t5", "gentle-ai-worker", "queued"),
			sub("t6", "gentle-ai-worker", "running"),
			sub("t6", "gentle-ai-worker", "cancelled"),
			sub("t7", "gentle-ai-worker", "running"),
			sub("t1", "gentle-ai-worker", "failed"),
			departed("t1"),
		);
		assert.deepEqual(seatOf(state, "t7"), { zone: "desk", index: 0 });
		assert.deepEqual(seatOf(state, "t5"), { zone: "bench", index: 0 });
	});

	it("inspectors and judges never get a desk; they are logged only", () => {
		const state = run(sub("r1", "review-risk", "running"), sub("j1", "jd-judge-a", "running"));
		const view = sceneView(state);
		assert.deepEqual(view.agents, [], "non-resident agents are not drawn as residents");
		assert.deepEqual(state.seats.desks, [null, null, null, null]);
		assert.deepEqual(state.seats.bench, []);
		assert.equal(view.activeAgents, 2, "they still count as running subagents");
		assert.match(state.log[0].text, /running/);
	});

	it("an unknown agent is a generic worker and takes a desk", () => {
		const state = run(sub("t1", "unknown", "running", ""));
		assert.deepEqual(seatOf(state, "t1"), { zone: "desk", index: 0 });
	});

	it("departing an unknown id changes nothing", () => {
		const start = run(sub("t1", "gentle-ai-worker", "running"));
		assert.deepEqual(reduceScene(start, departed("nope")).seats, start.seats);
	});
});

describe("reducer transitions per status", () => {
	it("queued, running, waiting are active and keep the seat until they finish", () => {
		for (const status of ["running", "waiting"]) {
			const view = sceneView(run(sub("t1", "gentle-ai-explore", status)));
			assert.equal(view.activeAgents, 1, status);
			assert.equal(view.agents[0].status, status);
			assert.equal(view.agents[0].leaving, false);
		}
	});

	it("completed, failed, cancelled and timed_out start leaving and keep the seat for the exit", () => {
		for (const status of ["completed", "failed", "cancelled", "timed_out"]) {
			const state = run(sub("t1", "gentle-ai-worker", "running"), sub("t1", "gentle-ai-worker", status));
			const agent = sceneView(state).agents[0];
			assert.equal(agent.status, status, status);
			assert.equal(agent.leaving, true, status);
			assert.deepEqual(agent.seat, { zone: "desk", index: 0 }, status);
			assert.equal(sceneView(state).activeAgents, 0, status);
		}
	});

	it("a terminal event for an agent that never had a seat is dropped at once", () => {
		assert.deepEqual(sceneView(run(sub("t9", "gentle-ai-worker", "completed"))).agents, []);
	});

	it("logs a line when the status changes, not on a repeated status", () => {
		const state = run(sub("t1", "gentle-ai-worker", "running"), sub("t1", "gentle-ai-worker", "running"));
		assert.equal(state.log.length, 1);
	});
});

describe("snapshot restores the room", () => {
	it("seats the agents of a snapshot at their desks, marked as already there", () => {
		const state = reduceScene(initialScene(), snapshot([
			{ id: "t1", agent: "gentle-ai-explore", role: "explore", label: "map", status: "running" },
			{ id: "t2", agent: "gentle-ai-worker", role: "worker", label: "job", status: "waiting" },
		]));
		const agents = sceneView(state).agents;
		assert.deepEqual(agents.map((agent: { seat: unknown }) => agent.seat), [
			{ zone: "desk", index: 0 },
			{ zone: "desk", index: 1 },
		]);
		assert.ok(agents.every((agent: { instant: boolean }) => agent.instant === true), "no walk-in for restored agents");
	});

	it("a reconnect keeps seated agents where they are and seats only the new ones", () => {
		const live = run(sub("t1", "gentle-ai-explore", "running"));
		const state = reduceScene(live, snapshot([
			{ id: "t2", agent: "gentle-ai-worker", role: "worker", label: "job", status: "running" },
			{ id: "t1", agent: "gentle-ai-explore", role: "explore", label: "map", status: "running" },
		]));
		const byId = Object.fromEntries(sceneView(state).agents.map((agent: { id: string }) => [agent.id, agent]));
		assert.deepEqual(byId.t1.seat, { zone: "desk", index: 0 });
		assert.equal(byId.t1.instant, false, "an agent already on screen is not re-admitted");
		assert.deepEqual(byId.t2.seat, { zone: "desk", index: 1 });
		assert.equal(byId.t2.instant, true);
	});

	it("drops a seated agent the snapshot no longer lists", () => {
		const live = run(sub("t1", "gentle-ai-explore", "running"), sub("t2", "gentle-ai-worker", "running"));
		const state = reduceScene(live, snapshot([{ id: "t2", agent: "gentle-ai-worker", role: "worker", label: "job", status: "running" }]));
		assert.equal(seatOf(state, "t1"), undefined);
		assert.deepEqual(state.seats.desks, [null, "t2", null, null]);
	});

	it("does not seat a finished snapshot agent that has no seat", () => {
		const state = reduceScene(initialScene(), snapshot([{ id: "t1", agent: "gentle-ai-worker", role: "worker", label: "job", status: "completed" }]));
		assert.deepEqual(sceneView(state).agents, []);
	});
});

describe("lounge staff (S16): a running agent claims the staff member of its role", () => {
	const staffOf = (state: Scene, role: string) => sceneView(state).staff.find((item: { role: string }) => item.role === role);
	const claimOf = (state: Scene, id: string) => sceneView(state).agents.find((agent: { id: string }) => agent.id === id)?.claimed;

	it("a running subagent claims the staff member of its role and takes the first free desk", () => {
		const state = run(sub("t1", "gentle-ai-explore", "running"));
		assert.deepEqual(staffOf(state, "explore"), { role: "explore", present: false, claimedBy: "t1" });
		assert.deepEqual(staffOf(state, "worker"), { role: "worker", present: true, claimedBy: null });
		assert.deepEqual(seatOf(state, "t1"), { zone: "desk", index: 0 });
		assert.equal(claimOf(state, "t1"), true);
	});

	it("a queued agent does not claim; it claims once it starts with a desk free", () => {
		assert.equal(staffOf(run(sub("t1", "gentle-ai-verify", "queued")), "verify")?.present, true);
		const started = run(sub("t1", "gentle-ai-verify", "queued"), sub("t1", "gentle-ai-verify", "running"));
		assert.equal(staffOf(started, "verify")?.claimedBy, "t1");
	});

	it("a second agent of the same role is an extra: no claim, it takes the next desk", () => {
		const state = run(sub("t1", "gentle-ai-worker", "running"), sub("t2", "gentle-ai-worker", "running"));
		assert.equal(staffOf(state, "worker")?.claimedBy, "t1");
		assert.deepEqual(seatOf(state, "t2"), { zone: "desk", index: 1 });
		assert.equal(claimOf(state, "t2"), false);
	});

	it("unknown-role agents take a desk but never claim a staff member", () => {
		const unknown = { type: "event", seq: 1, at, event: { v: 1, type: "subagent", id: "t1", agent: "mystery", role: "bogus", label: "", status: "running" } };
		const state = run(unknown);
		assert.deepEqual(seatOf(state, "t1"), { zone: "desk", index: 0 });
		assert.ok(sceneView(state).staff.every((item: { present: boolean }) => item.present), "every staff member is still in the lounge");
	});

	it("a bench agent that gets a desk for the first time claims a staff member that is free", () => {
		const state = run(
			sub("t1", "gentle-ai-explore", "running"),
			sub("t2", "gentle-ai-worker", "running"),
			sub("t3", "gentle-ai-worker", "running"),
			sub("t4", "gentle-ai-worker", "running"),
			sub("t5", "gentle-ai-explore", "running"),
			sub("t1", "gentle-ai-explore", "completed"),
			departed("t1"),
		);
		assert.deepEqual(seatOf(state, "t5"), { zone: "desk", index: 0 });
		assert.equal(staffOf(state, "explore")?.claimedBy, "t5");
	});

	it("finishing the claimant keeps its desk and claim while it walks back, then frees both on departure", () => {
		const finishing = run(sub("t1", "gentle-ai-explore", "running"), sub("t1", "gentle-ai-explore", "completed"));
		assert.deepEqual(seatOf(finishing, "t1"), { zone: "desk", index: 0 }, "still seated while it walks");
		assert.equal(staffOf(finishing, "explore")?.claimedBy, "t1");
		assert.equal(claimOf(finishing, "t1"), true, "it walks back to the lounge, not the door");
		const back = reduceScene(finishing, departed("t1"));
		assert.deepEqual(staffOf(back, "explore"), { role: "explore", present: true, claimedBy: null });
		assert.equal(back.seats.desks[0], null, "the desk is free");
	});

	it("a failed, cancelled or timed-out claimant walks back to the lounge as well", () => {
		for (const status of ["failed", "cancelled", "timed_out"]) {
			const state = run(sub("t1", "gentle-ai-worker", "running"), sub("t1", "gentle-ai-worker", status), departed("t1"));
			assert.deepEqual(staffOf(state, "worker"), { role: "worker", present: true, claimedBy: null }, status);
		}
	});

	it("an extra leaves by the door and does not release the staff member's claim", () => {
		const state = run(sub("t1", "gentle-ai-worker", "running"), sub("t2", "gentle-ai-worker", "running"), sub("t2", "gentle-ai-worker", "completed"), departed("t2"));
		assert.equal(staffOf(state, "worker")?.claimedBy, "t1");
		assert.equal(seatOf(state, "t2"), undefined);
	});

	it("a claim always points at an agent that holds a desk, across events and snapshots", () => {
		const script: unknown[] = [
			sub("t1", "gentle-ai-explore", "running"),
			sub("t2", "gentle-ai-worker", "running"),
			sub("t3", "gentle-ai-worker", "running"),
			snapshot([{ id: "t3", agent: "gentle-ai-worker", role: "worker", label: "job", status: "running" }]),
			sub("t4", "gentle-ai-explore", "running"),
			sub("t1", "gentle-ai-explore", "completed"),
			departed("t1"),
			sub("t5", "gentle-ai-explore", "running"),
			departed("t2"),
		];
		let state = initialScene();
		for (const action of script) {
			state = reduceScene(state, action as never);
			for (const role of ["explore", "worker", "verify"]) {
				const id = staffOf(state, role)?.claimedBy;
				if (id !== null && id !== undefined) assert.ok(state.seats.desks.includes(id), `${role} claim ${id} sits at a desk`);
			}
		}
	});

	it("snapshot: a restored claimant sits at its desk already claimed, with no walk-in", () => {
		const state = reduceScene(initialScene(), snapshot([{ id: "t1", agent: "gentle-ai-explore", role: "explore", label: "map", status: "running" }]));
		assert.equal(staffOf(state, "explore")?.claimedBy, "t1");
		assert.deepEqual(seatOf(state, "t1"), { zone: "desk", index: 0 });
		assert.equal(sceneView(state).agents[0].instant, true);
	});

	it("snapshot: a claimant the snapshot no longer lists releases its staff member", () => {
		const state = reduceScene(run(sub("t1", "gentle-ai-explore", "running")), snapshot([]));
		assert.deepEqual(staffOf(state, "explore"), { role: "explore", present: true, claimedBy: null });
	});

	it("snapshot: a finished claimant that is still listed keeps its claim until it departs", () => {
		const live = run(sub("t1", "gentle-ai-explore", "running"), sub("t1", "gentle-ai-explore", "completed"));
		const state = reduceScene(live, snapshot([{ id: "t1", agent: "gentle-ai-explore", role: "explore", label: "map", status: "completed" }]));
		assert.equal(staffOf(state, "explore")?.claimedBy, "t1");
		assert.equal(staffOf(reduceScene(state, departed("t1")), "explore")?.present, true);
	});
});

describe("verify corner (S17): verify residents sit in the verify seats first", () => {
	const verifySeat = (state: Scene, id: string) => (sceneView(state).agents.find((agent: { id: string }) => agent.id === id) as { seat?: unknown } | undefined)?.seat;

	it("a verify agent sits in the verify corner, not at the pod", () => {
		const state = run(sub("v1", "gentle-ai-verify", "running"));
		assert.deepEqual(verifySeat(state, "v1"), { zone: "verify", index: 0 });
		assert.deepEqual(state.seats.desks, [null, null, null, null], "the pod stays free");
	});

	it("the second verify agent takes the second verify seat; the third takes a pod desk", () => {
		const state = run(sub("v1", "gentle-ai-verify", "running"), sub("v2", "gentle-ai-verify", "running"), sub("v3", "gentle-ai-verify", "running"));
		assert.deepEqual(verifySeat(state, "v1"), { zone: "verify", index: 0 });
		assert.deepEqual(verifySeat(state, "v2"), { zone: "verify", index: 1 });
		assert.deepEqual(verifySeat(state, "v3"), { zone: "desk", index: 0 }, "an extra verify agent uses the pod");
	});

	it("explore and worker agents never take a verify seat", () => {
		const state = run(sub("e1", "gentle-ai-explore", "running"), sub("w1", "gentle-ai-worker", "running"), sub("w2", "gentle-ai-worker", "running"));
		assert.deepEqual(state.seats.verify, [null, null], "the verify corner stays free");
		assert.deepEqual(verifySeat(state, "e1"), { zone: "desk", index: 0 });
		assert.deepEqual(verifySeat(state, "w1"), { zone: "desk", index: 1 });
		assert.deepEqual(verifySeat(state, "w2"), { zone: "desk", index: 2 });
	});

	it("a queued verify agent takes the first verify seat that frees, before a queued worker", () => {
		const state = run(
			sub("v1", "gentle-ai-verify", "running"), sub("v2", "gentle-ai-verify", "running"),
			sub("w1", "gentle-ai-worker", "running"), sub("w2", "gentle-ai-worker", "running"), sub("w3", "gentle-ai-worker", "running"), sub("w4", "gentle-ai-worker", "running"),
			sub("v3", "gentle-ai-verify", "running"), sub("w5", "gentle-ai-worker", "running"),
			departed("v1"),
		);
		assert.deepEqual(verifySeat(state, "v3"), { zone: "verify", index: 0 }, "the verify seat goes to the verify agent waiting on the bench");
		assert.deepEqual(seatOf(state, "w5"), { zone: "bench", index: 0 }, "the worker stays on the bench until a pod desk frees");
	});
});
