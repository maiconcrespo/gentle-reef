import { OFFICE_EVENT_VERSION } from "./office-event.ts";

// Inbound boss input (S9). Defined and validated here; not wired to Pi yet (T8 wires it).
export const MAX_BOSS_INPUT_CHARS = 4000;

export interface BossInputEvent {
	readonly v: typeof OFFICE_EVENT_VERSION;
	readonly type: "boss.input";
	readonly text: string;
}

export type BossInputResult = { readonly ok: true; readonly event: BossInputEvent } | { readonly ok: false; readonly reason: string };

const reject = (reason: string): BossInputResult => ({ ok: false, reason });

export function validateBossInput(value: unknown): BossInputResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return reject("message must be an object");
	const record = value as Record<string, unknown>;
	if (record.type !== "boss.input") return reject("unsupported message type");
	if (record.v !== undefined && record.v !== OFFICE_EVENT_VERSION) return reject("unsupported contract version");
	if (typeof record.text !== "string") return reject("text must be a string");
	if (record.text.trim().length === 0) return reject("text must not be empty");
	if (record.text.length > MAX_BOSS_INPUT_CHARS) return reject(`text exceeds ${MAX_BOSS_INPUT_CHARS} characters`);
	return { ok: true, event: { v: OFFICE_EVENT_VERSION, type: "boss.input", text: record.text } };
}
