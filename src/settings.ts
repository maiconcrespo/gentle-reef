import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Lives next to Pi's settings in the agent dir (S2). Missing or invalid means disabled.
export const OFFICE_SETTINGS_FILE = "gentle-office.json";

export interface OfficeSettings {
	readonly enabled: boolean;
}

export type OfficeSettingsWrite = { readonly ok: true } | { readonly ok: false; readonly error: string };

export function officeSettingsPath(agentDir: string): string {
	return join(agentDir, OFFICE_SETTINGS_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(path: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** Never throws. Only an explicit `enabled: true` turns the module on. */
export function readOfficeSettings(agentDir: string): OfficeSettings {
	return { enabled: readRecord(officeSettingsPath(agentDir))?.enabled === true };
}

/** Writes `enabled` and keeps any other keys already in the file. */
export function writeOfficeSettings(agentDir: string, settings: OfficeSettings): OfficeSettingsWrite {
	const path = officeSettingsPath(agentDir);
	try {
		mkdirSync(agentDir, { recursive: true });
		const existing = readRecord(path) ?? {};
		writeFileSync(path, `${JSON.stringify({ ...existing, enabled: settings.enabled }, null, 2)}\n`);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
