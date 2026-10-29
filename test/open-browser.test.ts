import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { openInBrowser } from "../src/server/open-browser.ts";

const URL_OK = "http://127.0.0.1:4321/abcTOKEN_-x/";

// Fake spawn: records the call and emits "spawn" on the next tick unless the test says otherwise.
function fakeSpawn(mode: "spawn" | "error" | "throw" = "spawn") {
	const calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];
	const unrefs = { count: 0 };
	const spawn = (command: string, args: readonly string[], options: Record<string, unknown>) => {
		calls.push({ command, args, options });
		if (mode === "throw") throw new Error("spawn exploded");
		const child = new EventEmitter() as EventEmitter & { unref(): void };
		child.unref = () => { unrefs.count++; };
		setImmediate(() => child.emit(mode === "error" ? "error" : "spawn", ...(mode === "error" ? [new Error("ENOENT")] : [])));
		return child;
	};
	return { spawn, calls, unrefs };
}

describe("openInBrowser", () => {
	it("refuses anything but a loopback http URL and never spawns", async () => {
		for (const bad of ["https://127.0.0.1:4321/", "http://example.com/", "http://192.168.1.5:4321/", "file:///etc/passwd", "http://127.0.0.1:4321/tok/?x=1;rm -rf"]) {
			const fake = fakeSpawn();
			const result = await openInBrowser(bad, { platform: "linux", spawn: fake.spawn, env: {} });
			assert.equal(result.opened, false, bad);
			assert.equal(fake.calls.length, 0, bad);
		}
	});

	it("uses open on macOS and xdg-open on Linux, detached, without a shell, and unrefs the child", async () => {
		const mac = fakeSpawn();
		assert.deepEqual(await openInBrowser(URL_OK, { platform: "darwin", spawn: mac.spawn, env: {} }), { opened: true });
		assert.deepEqual(mac.calls[0].command, "/usr/bin/open");
		assert.deepEqual(mac.calls[0].args, [URL_OK]);
		assert.equal(mac.calls[0].options.detached, true);
		assert.equal(mac.calls[0].options.shell, false);
		assert.equal(mac.unrefs.count, 1);

		const linux = fakeSpawn();
		assert.equal((await openInBrowser(URL_OK, { platform: "linux", spawn: linux.spawn, env: {} })).opened, true);
		assert.equal(linux.calls[0].command, "xdg-open");
	});

	it("on Windows uses the absolute rundll32 under SystemRoot, and refuses when SystemRoot is not absolute", async () => {
		const win = fakeSpawn();
		await openInBrowser(URL_OK, { platform: "win32", spawn: win.spawn, env: { SystemRoot: "C:\\Windows" } });
		assert.match(win.calls[0].command, /^C:\\Windows\\System32\\rundll32\.exe$/);
		assert.deepEqual(win.calls[0].args, ["url.dll,FileProtocolHandler", URL_OK]);

		const bare = fakeSpawn();
		const result = await openInBrowser(URL_OK, { platform: "win32", spawn: bare.spawn, env: { SystemRoot: "Windows" } });
		assert.equal(result.opened, false);
		assert.equal(bare.calls.length, 0);
	});

	it("reports a spawn failure instead of throwing", async () => {
		const thrown = fakeSpawn("throw");
		assert.deepEqual(await openInBrowser(URL_OK, { platform: "linux", spawn: thrown.spawn, env: {} }), { opened: false, error: "spawn exploded" });
		const missing = fakeSpawn("error");
		const result = await openInBrowser(URL_OK, { platform: "linux", spawn: missing.spawn, env: {} });
		assert.equal(result.opened, false);
		assert.equal(result.error, "ENOENT");
	});
});
