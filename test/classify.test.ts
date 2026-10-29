import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { featureForAgent, featureForTool, roleForAgent } from "../src/contract/classify.ts";

describe("roleForAgent", () => {
	it("maps the gentle-ai resident agents to their desks", () => {
		assert.equal(roleForAgent("gentle-ai-explore"), "explore");
		assert.equal(roleForAgent("gentle-ai-worker"), "worker");
		assert.equal(roleForAgent("worker"), "worker");
		assert.equal(roleForAgent("gentle-ai-verify"), "verify");
	});

	it("maps review agents to inspectors and judgment agents to judges", () => {
		assert.equal(roleForAgent("review-security"), "inspector");
		assert.equal(roleForAgent("jd-judge-a"), "judge");
		assert.equal(roleForAgent("jd-judge-b"), "judge");
		assert.equal(roleForAgent("jd-fix-agent"), "worker");
	});

	it("falls back to worker for unknown or missing agents", () => {
		assert.equal(roleForAgent("some-random-agent"), "worker");
		assert.equal(roleForAgent("constructor"), "worker");
		assert.equal(roleForAgent(undefined), "worker");
	});
});

describe("featureForTool", () => {
	it("maps tool names to gentle-shell features", () => {
		assert.equal(featureForTool("mem_save"), "memory");
		assert.equal(featureForTool("web_search"), "web");
		assert.equal(featureForTool("fetch_content"), "web");
		assert.equal(featureForTool("gentle_design_comments"), "design");
		assert.equal(featureForTool("todo"), "todo");
		assert.equal(featureForTool("ask_user_question"), "ask");
		assert.equal(featureForTool("gentle_review_capture"), "review");
		assert.equal(featureForTool("codegraph"), "codegraph");
		assert.equal(featureForTool("mcp"), "mcp");
	});

	it("returns undefined for tools without a feature", () => {
		assert.equal(featureForTool("read"), undefined);
		assert.equal(featureForTool("bash"), undefined);
	});
});

describe("featureForAgent", () => {
	it("maps review and judgment agents to their features", () => {
		assert.equal(featureForAgent("review-security"), "review");
		assert.equal(featureForAgent("jd-judge-a"), "judgment");
		assert.equal(featureForAgent("gentle-ai-explore"), undefined);
	});
});
