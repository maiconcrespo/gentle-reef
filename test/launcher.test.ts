import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = fileURLToPath(new URL("..", import.meta.url));
const launcher = join(repo, "bin", "gentle-reef");

// Fake gentle-shell: reports the terminal variable and each argument on its own line, then exits with FAKE_STATUS.
const FAKE_GENTLE_SHELL = [
	"#!/bin/sh",
	'printf "GENTLE_REEF=%s\\n" "$GENTLE_REEF"',
	'for arg in "$@"; do printf "arg=%s\\n" "$arg"; done',
	'exit "${FAKE_STATUS:-0}"',
	"",
].join("\n");

let root: string;
let fakeBin: string;
before(() => {
	root = mkdtempSync(join(tmpdir(), "gentle-reef-launcher-"));
	fakeBin = join(root, "bin");
	mkdirSync(fakeBin);
	writeFileSync(join(fakeBin, "gentle-shell"), FAKE_GENTLE_SHELL);
	chmodSync(join(fakeBin, "gentle-shell"), 0o755);
});
after(() => { rmSync(root, { recursive: true, force: true }); });

// Runs the launcher by path (so its shebang and executable bit are exercised) with only the given PATH.
const runLauncher = (path: string, args: string[], extraEnv: Record<string, string> = {}) =>
	spawnSync(launcher, args, { encoding: "utf8", env: { PATH: path, ...extraEnv } });

describe("bin/gentle-reef", () => {
	it("is an executable shell script, and package.json exposes it as the gentle-reef bin", () => {
		assert.ok((statSync(launcher).mode & 0o111) !== 0, "must be executable");
		assert.match(readFileSync(launcher, "utf8").split("\n")[0]!, /^#!\/bin\/sh$/);
		const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
		assert.deepEqual(manifest.bin, { "gentle-reef": "./bin/gentle-reef" });
	});

	it("sets GENTLE_REEF=1 and passes every argument through unchanged", () => {
		const result = runLauncher(fakeBin, ["--model", "two words", "", "last"]);
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(result.stdout.split("\n").filter(Boolean), [
			"GENTLE_REEF=1",
			"arg=--model",
			"arg=two words",
			"arg=",
			"arg=last",
		]);
	});

	it("overrides an inherited GENTLE_REEF value", () => {
		const result = runLauncher(fakeBin, [], { GENTLE_REEF: "0" });
		assert.equal(result.stdout.trim(), "GENTLE_REEF=1");
	});

	it("returns the exit status of gentle-shell", () => {
		const result = runLauncher(fakeBin, [], { FAKE_STATUS: "3" });
		assert.equal(result.status, 3);
	});

	it("fails with a clear message when gentle-shell is not on PATH", () => {
		const empty = join(root, "empty");
		mkdirSync(empty);
		const result = runLauncher(empty, []);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /gentle-reef: gentle-shell not found on PATH/);
	});
});
