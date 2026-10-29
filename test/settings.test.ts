import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officeSettingsPath, readOfficeSettings, writeOfficeSettings } from "../src/settings.ts";

let root: string;
before(() => { root = mkdtempSync(join(tmpdir(), "gentle-office-settings-")); });
after(() => { rmSync(root, { recursive: true, force: true }); });

const freshAgentDir = (name: string): string => {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	return dir;
};

describe("readOfficeSettings", () => {
	it("is disabled when the settings file is missing", () => {
		assert.deepEqual(readOfficeSettings(freshAgentDir("missing")), { enabled: false });
	});

	it("is disabled when the file is not valid JSON", () => {
		const dir = freshAgentDir("bad-json");
		writeFileSync(officeSettingsPath(dir), "{ enabled: ");
		assert.deepEqual(readOfficeSettings(dir), { enabled: false });
	});

	it("is disabled when the JSON is not an object or enabled is not exactly true", () => {
		const dir = freshAgentDir("bad-shape");
		for (const body of ["true", "[]", "null", '{"enabled":"yes"}', '{"enabled":1}']) {
			writeFileSync(officeSettingsPath(dir), body);
			assert.deepEqual(readOfficeSettings(dir), { enabled: false }, body);
		}
	});

	it("is enabled only when the file says enabled: true", () => {
		const dir = freshAgentDir("valid");
		writeFileSync(officeSettingsPath(dir), '{ "enabled": true }');
		assert.deepEqual(readOfficeSettings(dir), { enabled: true });
	});
});

describe("writeOfficeSettings", () => {
	it("creates the agent dir and file, keeps other keys, and reads back the new value", () => {
		const dir = join(root, "fresh", "agent");
		assert.deepEqual(writeOfficeSettings(dir, { enabled: true }), { ok: true });
		assert.deepEqual(readOfficeSettings(dir), { enabled: true });

		writeFileSync(officeSettingsPath(dir), '{ "enabled": true, "theme": "pink" }');
		assert.deepEqual(writeOfficeSettings(dir, { enabled: false }), { ok: true });
		assert.deepEqual(JSON.parse(readFileSync(officeSettingsPath(dir), "utf8")), { enabled: false, theme: "pink" });
	});

	it("reports an error instead of throwing when the agent dir cannot be created", () => {
		const blocker = join(root, "blocker");
		writeFileSync(blocker, "a regular file");
		const result = writeOfficeSettings(join(blocker, "agent"), { enabled: true });
		assert.equal(result.ok, false);
	});
});
