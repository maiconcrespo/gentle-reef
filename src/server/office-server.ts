import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OfficeHub } from "../adapter/hub.ts";

// Loopback window for the Gentle Office (S3). Outbound only: the page gets the
// hub's snapshot and live events over SSE and has no route that accepts input.
// Guards: 127.0.0.1 bind, random per-instance token in the path, Host check
// against DNS rebinding, GET-only, a fixed asset whitelist, and a CSP.

const HOST = "127.0.0.1";
const DEFAULT_HEARTBEAT_MS = 15_000;
/** A client that stops reading is dropped; its EventSource reconnects and gets a fresh snapshot. */
const MAX_CLIENT_BACKLOG_BYTES = 1024 * 1024;
const DEFAULT_ASSETS_DIR = fileURLToPath(new URL("../../web/", import.meta.url));

const ASSET_TYPES: Readonly<Record<string, string>> = Object.freeze({
	"index.html": "text/html; charset=utf-8",
	"office.css": "text/css; charset=utf-8",
	"app.js": "text/javascript; charset=utf-8",
	"office-engine.js": "text/javascript; charset=utf-8",
	"scene-reducer.js": "text/javascript; charset=utf-8",
});

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const BASE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"Cache-Control": "no-store",
	"Content-Security-Policy": CSP,
	"Cross-Origin-Resource-Policy": "same-origin",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
});

export interface OfficeOpenResult {
	readonly url: string;
	readonly opened: boolean;
	readonly error?: string;
}

export interface OfficeServerStatus {
	readonly running: boolean;
	readonly url?: string;
	readonly clients: number;
}

export interface OfficeServerOptions {
	readonly hub: OfficeHub;
	/** Directory with the page and its assets. Defaults to the package's web/ directory. */
	readonly assetsDir?: string;
	/** Hands the URL to the platform browser opener. Never throws; reports through its result. */
	readonly openUrl?: (url: string) => Promise<{ readonly opened: boolean; readonly error?: string }>;
	readonly heartbeatMs?: number;
}

export interface OfficeServer {
	/** Starts the loopback server once per instance and resolves with the window URL (ends with `/`). */
	start(): Promise<string>;
	/** Starts if needed, then asks the opener to show the URL. */
	open(): Promise<OfficeOpenResult>;
	/** Closes every live client and the listener. Idempotent. */
	stop(): Promise<void>;
	status(): OfficeServerStatus;
}

interface Loaded {
	readonly bodies: ReadonlyMap<string, Buffer>;
}

async function loadAssets(dir: string): Promise<Loaded> {
	const entries = await Promise.all(Object.keys(ASSET_TYPES).map(async (name) => [name, await readFile(join(dir, name))] as const));
	return { bodies: new Map(entries) };
}

function sameToken(expected: string, candidate: string): boolean {
	const a = Buffer.from(expected);
	const b = Buffer.from(candidate);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function createOfficeServer(options: OfficeServerOptions): OfficeServer {
	const { hub } = options;
	const assetsDir = options.assetsDir ?? DEFAULT_ASSETS_DIR;
	const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
	const openUrl = options.openUrl ?? (async () => ({ opened: false, error: "no browser opener configured" }));

	let http: Server | undefined;
	let assets: ReadonlyMap<string, Buffer> = new Map();
	let token = "";
	let port = 0;
	let url: string | undefined;
	let starting: Promise<string> | undefined;
	let heartbeat: NodeJS.Timeout | undefined;
	/** Each live SSE response with the function that unsubscribes it from the hub. */
	const clients = new Map<ServerResponse, () => void>();

	function reply(res: ServerResponse, status: number, body: string): void {
		res.writeHead(status, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)) });
		res.end(body);
	}

	function serveAsset(res: ServerResponse, name: string): void {
		const body = assets.get(name);
		const type = ASSET_TYPES[name];
		if (body === undefined || type === undefined) return reply(res, 404, "not found\n");
		res.writeHead(200, { ...BASE_HEADERS, "Content-Type": type, "Content-Length": String(body.length) });
		res.end(body);
	}

	function write(res: ServerResponse, chunk: string): void {
		if (res.writableEnded || res.destroyed) return;
		res.write(chunk);
		if (res.writableLength > MAX_CLIENT_BACKLOG_BYTES) res.destroy();
	}

	function openStream(res: ServerResponse): void {
		res.writeHead(200, {
			...BASE_HEADERS,
			"Content-Type": "text/event-stream; charset=utf-8",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		write(res, "retry: 2000\n\n");
		// Snapshot first, then live events. Both happen in this one synchronous turn, so no event can slip between them.
		const snapshot = hub.snapshot();
		write(res, `id: ${hub.stats().published}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
		const unsubscribe = hub.subscribe((envelope) => {
			write(res, `id: ${envelope.seq}\nevent: office\ndata: ${JSON.stringify(envelope)}\n\n`);
		});
		let dropped = false;
		const drop = (): void => {
			if (dropped) return;
			dropped = true;
			unsubscribe();
			clients.delete(res);
		};
		clients.set(res, drop);
		res.on("close", drop);
		res.on("error", drop);
	}

	function handle(req: IncomingMessage, res: ServerResponse): void {
		const host = req.headers.host;
		if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) return reply(res, 403, "forbidden\n");
		const raw = req.url ?? "";
		if (!raw.startsWith("/")) return reply(res, 404, "not found\n");
		// The query string never selects anything; a bare token without a trailing slash is not the page.
		const parts = raw.split("?")[0].split("/");
		if (parts.length < 3 || !sameToken(token, parts[1])) return reply(res, 404, "not found\n");
		if (req.method !== "GET") return reply(res, 404, "not found\n");
		const rest = parts.slice(2).join("/");
		if (rest === "") return serveAsset(res, "index.html");
		if (rest === "events") return openStream(res);
		return serveAsset(res, rest);
	}

	async function launch(): Promise<string> {
		const loaded = await loadAssets(assetsDir);
		const nextToken = randomBytes(24).toString("base64url");
		// HTTP/1.1 without Host is refused by the parser (400) before any route runs; our own check covers the rest.
		const server = createServer({ maxHeaderSize: 16 * 1024, requireHostHeader: true }, (req, res) => {
			try {
				handle(req, res);
			} catch {
				if (res.headersSent) res.destroy();
				else reply(res, 500, "internal error\n");
			}
		});
		server.headersTimeout = 10_000;
		server.requestTimeout = 30_000;
		server.keepAliveTimeout = 5_000;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, HOST, () => {
				server.off("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === "string" || address.address !== HOST) {
			server.close();
			throw new Error("office window server is not bound to 127.0.0.1");
		}
		token = nextToken;
		port = address.port;
		assets = loaded.bodies;
		http = server;
		url = `http://${HOST}:${port}/${token}/`;
		heartbeat = setInterval(() => {
			for (const res of clients.keys()) write(res, ": heartbeat\n\n");
		}, heartbeatMs);
		heartbeat.unref();
		return url;
	}

	const start = (): Promise<string> => {
		if (url !== undefined) return Promise.resolve(url);
		starting ??= launch().finally(() => { starting = undefined; });
		return starting;
	};

	return {
		start,
		async open() {
			const address = await start();
			try {
				return { url: address, ...(await openUrl(address)) };
			} catch (error) {
				return { url: address, opened: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
		async stop() {
			if (starting) await starting.catch(() => undefined);
			const server = http;
			if (!server) return;
			// Synchronous part first, so status() and the hub are already clean when stop() is called.
			http = undefined;
			url = undefined;
			clearInterval(heartbeat);
			heartbeat = undefined;
			for (const [res, drop] of clients) {
				drop();
				res.end();
			}
			const closed = new Promise<void>((resolve) => server.close(() => resolve()));
			server.closeAllConnections();
			await closed;
		},
		status(): OfficeServerStatus {
			return { running: http !== undefined, ...(url === undefined ? {} : { url }), clients: clients.size };
		},
	};
}
