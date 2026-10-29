import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { connect, type Socket } from "node:net";
import { get, request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { OfficeHub } from "../src/adapter/hub.ts";
import { createOfficeServer, type OfficeServer } from "../src/server/office-server.ts";
import type { OfficeEvent } from "../src/contract/office-event.ts";

const thinking: OfficeEvent = { v: 1, type: "orchestrator", state: "thinking" };

const servers: OfficeServer[] = [];
const sockets: Array<{ destroy(): void }> = [];
after(async () => {
	for (const server of servers.splice(0)) await server.stop();
});
afterEach(() => {
	for (const socket of sockets.splice(0)) socket.destroy();
});

function makeServer(options: { heartbeatMs?: number; openUrl?: (url: string) => Promise<{ opened: boolean; error?: string }> } = {}) {
	const hub = new OfficeHub();
	const opened: string[] = [];
	const server = createOfficeServer({
		hub,
		heartbeatMs: options.heartbeatMs,
		openUrl: options.openUrl ?? (async (url: string) => { opened.push(url); return { opened: true }; }),
	});
	servers.push(server);
	return { hub, server, opened };
}

const portOf = (url: string): number => Number(new URL(url).port);
const tokenPath = (url: string): string => new URL(url).pathname;

interface Reply { status: number; headers: IncomingMessage["headers"]; body: string }

function send(port: number, path: string, options: { method?: string; host?: string } = {}): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const req = httpRequest({ host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.host ? { host: options.host } : {} }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk: string) => { body += chunk; });
			res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
		});
		req.on("error", reject);
		req.end();
	});
}

/** Minimal SSE reader: collects raw text and lets a test wait for a substring. */
interface Stream {
	readonly req: ClientRequest;
	readonly status: () => number;
	readonly text: () => string;
	readonly waitFor: (needle: string, timeoutMs?: number) => Promise<void>;
	readonly ended: Promise<void>;
}

function openStream(port: number, path: string, host?: string): Promise<Stream> {
	return new Promise((resolve, reject) => {
		let status = 0;
		let buffer = "";
		const waiters: Array<() => void> = [];
		const req = get({ host: "127.0.0.1", port, path, headers: host ? { host } : {} }, (res) => {
			status = res.statusCode ?? 0;
			res.setEncoding("utf8");
			res.on("data", (chunk: string) => {
				buffer += chunk;
				for (const wake of waiters.splice(0)) wake();
			});
			const ended = new Promise<void>((done) => { res.on("end", done); res.on("close", done); });
			resolve({
				req,
				status: () => status,
				text: () => buffer,
				ended,
				waitFor: (needle, timeoutMs = 1500) => new Promise((done, fail) => {
					const timer = setTimeout(() => fail(new Error(`timed out waiting for ${JSON.stringify(needle)} in ${JSON.stringify(buffer)}`)), timeoutMs);
					const check = () => { if (buffer.includes(needle)) { clearTimeout(timer); done(); } else waiters.push(check); };
					check();
				}),
			});
		});
		req.on("error", reject);
		sockets.push(req);
	});
}

async function until(check: () => boolean, timeoutMs = 1500): Promise<void> {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > timeoutMs) throw new Error("condition not reached in time");
		await new Promise((done) => setTimeout(done, 10));
	}
}

describe("loopback binding", () => {
	it("binds 127.0.0.1 on a random port and the URL names that host and port", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const parsed = new URL(url);
		assert.equal(parsed.protocol, "http:");
		assert.equal(parsed.hostname, "127.0.0.1");
		assert.notEqual(portOf(url), 0);
		assert.equal(server.status().running, true);
		assert.equal(server.status().url, url);
	});

	it("start is idempotent: one instance per session", async () => {
		const { server } = makeServer();
		const first = await server.start();
		const second = await server.start();
		assert.equal(second, first);
	});

	it("each instance gets its own unguessable token", async () => {
		const a = await makeServer().server.start();
		const b = await makeServer().server.start();
		assert.notEqual(tokenPath(a), tokenPath(b));
		assert.ok(tokenPath(a).length >= 34, "token must carry at least 128 bits of entropy in base64url");
	});

	it("stop is idempotent and reports not running", async () => {
		const { server } = makeServer();
		await server.start();
		await server.stop();
		await server.stop();
		assert.equal(server.status().running, false);
		assert.equal(server.status().url, undefined);
	});
});

describe("routes", () => {
	it("serves the office page under the token", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const reply = await send(portOf(url), tokenPath(url));
		assert.equal(reply.status, 200);
		assert.match(String(reply.headers["content-type"]), /^text\/html/);
		assert.match(reply.body, /<canvas[^>]*role="img"/);
		assert.match(reply.body, /aria-live="polite"/);
	});

	it("serves the web assets under the token with the right content types", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const expected: Array<[string, RegExp]> = [
			["office.css", /^text\/css/],
			["app.js", /^text\/javascript/],
			["scene-reducer.js", /^text\/javascript/],
			["office-engine.js", /^text\/javascript/],
		];
		for (const [name, type] of expected) {
			const reply = await send(portOf(url), `${tokenPath(url)}${name}`);
			assert.equal(reply.status, 200, name);
			assert.match(String(reply.headers["content-type"]), type, name);
		}
	});

	it("a wrong or missing token gets 404, including the bare origin and the token without a slash", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		const token = tokenPath(url).slice(1, -1);
		assert.equal((await send(port, "/")).status, 404);
		assert.equal((await send(port, "/not-the-token/")).status, 404);
		assert.equal((await send(port, `/${token.slice(0, -1)}x/`)).status, 404);
		assert.equal((await send(port, `/${token}`)).status, 404);
		assert.equal((await send(port, `/${token}/events`.replace(token, "nope"))).status, 404);
	});

	it("unknown assets, traversal and nested paths get 404", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		const base = tokenPath(url);
		for (const path of [`${base}server.js`, `${base}../package.json`, `${base}%2e%2e/package.json`, `${base}scene-reducer.js/extra`]) {
			assert.equal((await send(port, path)).status, 404, path);
		}
	});

	it("non-GET requests get 404: the page takes no input", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		const base = tokenPath(url);
		assert.equal((await send(port, `${base}events`, { method: "POST" })).status, 404);
		assert.equal((await send(port, base, { method: "PUT" })).status, 404);
		assert.equal((await send(port, `${base}`, { method: "OPTIONS" })).status, 404);
	});

	it("sends no CORS headers and no external origins", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		const base = tokenPath(url);
		for (const path of [base, `${base}app.js`, `${base}office.css`, `${base}nope`]) {
			const reply = await send(port, path);
			assert.equal(reply.headers["access-control-allow-origin"], undefined, path);
		}
		const page = await send(port, base);
		assert.equal(page.headers["x-content-type-options"], "nosniff");
		assert.match(String(page.headers["content-security-policy"]), /default-src 'none'/);
	});

	it("the served page and assets reference no external http(s) URLs", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		const base = tokenPath(url);
		for (const name of ["", "office.css", "app.js", "scene-reducer.js", "office-engine.js"]) {
			const reply = await send(port, `${base}${name}`);
			assert.doesNotMatch(reply.body, /https?:\/\//, `${name || "index.html"} must not name an external URL`);
		}
	});
});

describe("Host guard against DNS rebinding", () => {
	it("rejects a foreign Host header with 403", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		const reply = await send(port, tokenPath(url), { host: `evil.example:${port}` });
		assert.equal(reply.status, 403);
	});

	it("rejects the loopback name without the right port", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		assert.equal((await send(port, tokenPath(url), { host: "127.0.0.1" })).status, 403);
		assert.equal((await send(port, tokenPath(url), { host: `127.0.0.1:${port + 1}` })).status, 403);
	});

	it("accepts localhost on the right port", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		assert.equal((await send(port, tokenPath(url), { host: `localhost:${port}` })).status, 200);
	});

	it("rejects a request that carries no Host header at all (refused before any route)", async () => {
		const { server } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		const socket: Socket = connect(port, "127.0.0.1");
		sockets.push(socket);
		const status = await new Promise<string>((resolve, reject) => {
			let head = "";
			socket.on("data", (chunk) => { head += chunk.toString("utf8"); if (head.includes("\r\n")) { resolve(head.split("\r\n")[0]); socket.destroy(); } });
			socket.on("error", reject);
			socket.write(`GET ${tokenPath(url)} HTTP/1.1\r\nConnection: close\r\n\r\n`);
		});
		assert.match(status, /^HTTP\/1\.1 (400|403) /);
	});
});

describe("SSE stream", () => {
	it("sends a snapshot first, then every live event from the hub", async () => {
		const { server, hub } = makeServer();
		const url = await server.start();
		const stream = await openStream(portOf(url), `${tokenPath(url)}events`);
		assert.equal(stream.status(), 200);
		await stream.waitFor("event: snapshot");
		hub.publish(thinking);
		await stream.waitFor('"state":"thinking"');
		const text = stream.text();
		assert.match(text, /^[\s\S]*event: snapshot\ndata: \{[^\n]*"orchestrator"/);
		assert.ok(text.indexOf("event: snapshot") < text.indexOf("event: office"), "snapshot must come before live events");
		assert.match(text, /event: office\ndata: \{"seq":1,"event":\{"v":1,"type":"orchestrator","state":"thinking"\}\}/);
		stream.req.destroy();
	});

	it("keeps the connection alive with heartbeat comments", async () => {
		const { server } = makeServer({ heartbeatMs: 15 });
		const url = await server.start();
		const stream = await openStream(portOf(url), `${tokenPath(url)}events`);
		await stream.waitFor(": heartbeat");
		stream.req.destroy();
	});

	it("a client disconnect unsubscribes it from the hub", async () => {
		const { server, hub } = makeServer();
		const url = await server.start();
		const stream = await openStream(portOf(url), `${tokenPath(url)}events`);
		await stream.waitFor("event: snapshot");
		assert.equal(hub.stats().subscribers, 1);
		assert.equal(server.status().clients, 1);
		stream.req.destroy();
		await until(() => hub.stats().subscribers === 0);
		await until(() => server.status().clients === 0);
	});

	it("stop closes live clients, unsubscribes them and stops listening", async () => {
		const { server, hub } = makeServer();
		const url = await server.start();
		const port = portOf(url);
		const stream = await openStream(port, `${tokenPath(url)}events`);
		await stream.waitFor("event: snapshot");
		await server.stop();
		await stream.ended;
		assert.equal(hub.stats().subscribers, 0);
		assert.equal(server.status().running, false);
		await assert.rejects(send(port, tokenPath(url)));
	});

	it("an event published after stop goes nowhere", async () => {
		const { server, hub } = makeServer();
		await server.start();
		await server.stop();
		hub.publish(thinking);
		assert.equal(hub.stats().subscribers, 0);
	});
});

describe("open and status", () => {
	it("open starts the server and hands its URL to the opener once", async () => {
		const { server, opened } = makeServer();
		const result = await server.open();
		assert.equal(result.opened, true);
		assert.equal(result.url, server.status().url);
		assert.deepEqual(opened, [result.url]);
	});

	it("an opener failure is reported but the server keeps running", async () => {
		const { server } = makeServer({ openUrl: async () => ({ opened: false, error: "no opener" }) });
		const result = await server.open();
		assert.equal(result.opened, false);
		assert.equal(result.error, "no opener");
		assert.equal(server.status().running, true);
	});

	it("status counts connected windows", async () => {
		const { server } = makeServer();
		const url = await server.start();
		assert.equal(server.status().clients, 0);
		const stream = await openStream(portOf(url), `${tokenPath(url)}events`);
		await stream.waitFor("event: snapshot");
		assert.equal(server.status().clients, 1);
		stream.req.destroy();
	});
});
