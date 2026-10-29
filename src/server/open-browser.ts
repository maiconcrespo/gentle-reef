import { spawn as nodeSpawn } from "node:child_process";
import { win32 } from "node:path";

// Opens the office window in the default browser. Same shape as gentle-pi's
// lib/design-open-browser.ts: fixed per-platform command, shell: false, detached.

type SpawnedChild = {
	once(event: "spawn", listener: () => void): unknown;
	once(event: "error", listener: (error: Error) => void): unknown;
	unref(): void;
};

export interface OpenInBrowserDeps {
	readonly platform?: NodeJS.Platform;
	readonly spawn?: (command: string, args: readonly string[], options: Record<string, unknown>) => SpawnedChild;
	readonly env?: NodeJS.ProcessEnv;
}

export interface OpenInBrowserResult {
	readonly opened: boolean;
	readonly error?: string;
}

function openerFor(platform: NodeJS.Platform, url: string, env: NodeJS.ProcessEnv): { command: string; args: string[] } | string {
	if (platform === "darwin") return { command: "/usr/bin/open", args: [url] };
	if (platform === "win32") {
		// Absolute path: Windows would otherwise search the current directory first.
		const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
		if (typeof systemRoot !== "string" || !win32.isAbsolute(systemRoot)) return "SystemRoot is not set to an absolute path";
		return { command: win32.join(systemRoot, "System32", "rundll32.exe"), args: ["url.dll,FileProtocolHandler", url] };
	}
	return { command: "xdg-open", args: [url] };
}

/** Only this server's own loopback URL may reach an OS opener. */
function isLoopbackHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.href === url;
	} catch {
		return false;
	}
}

/** Resolves instead of throwing: a missing browser must not break Pi. */
export function openInBrowser(url: string, deps: OpenInBrowserDeps = {}): Promise<OpenInBrowserResult> {
	if (!isLoopbackHttpUrl(url)) return Promise.resolve({ opened: false, error: "only loopback http URLs can be opened" });
	const opener = openerFor(deps.platform ?? process.platform, url, deps.env ?? process.env);
	if (typeof opener === "string") return Promise.resolve({ opened: false, error: opener });
	const spawn = deps.spawn ?? (nodeSpawn as unknown as NonNullable<OpenInBrowserDeps["spawn"]>);
	return new Promise((resolve) => {
		let child: SpawnedChild;
		try {
			child = spawn(opener.command, opener.args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
		} catch (error) {
			resolve({ opened: false, error: error instanceof Error ? error.message : String(error) });
			return;
		}
		child.once("error", (error) => resolve({ opened: false, error: error.message }));
		child.once("spawn", () => resolve({ opened: true }));
		child.unref();
	});
}
