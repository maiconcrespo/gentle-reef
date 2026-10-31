/**
 * Notices in the scene (T4b). Other extensions report warnings with `ui.notify` (for example a rate-limit warning from a
 * provider bridge), and Pi emits no event for it. Every extension shares one ui object, so wrapping its notify once is
 * the only way to see them. Best effort: Pi's own notice always runs, and anything that cannot be wrapped is left alone.
 */

export type NoticeLevel = "info" | "warning" | "error";

export interface Notice {
	readonly text: string;
	readonly level: NoticeLevel;
	readonly at: number;
}

/** How long the newest notice stays in its box. */
export const NOTICE_MS = 20_000;

const WRAPPED = Symbol.for("gentle-reef.notify-wrapped");

type NotifyHost = { notify?: (...args: never[]) => void; [WRAPPED]?: true };

/** Wraps `ui.notify` once so each notice reaches `onNotice` before Pi shows it. Returns false when it did not wrap. */
export function wrapNotify(ui: object, onNotice: (notice: Notice) => void, now: () => number = Date.now): boolean {
	const host = ui as NotifyHost;
	const original = host.notify;
	if (typeof original !== "function" || host[WRAPPED]) return false;
	const wrapped = function (this: unknown, message?: unknown, type?: unknown) {
		try {
			const level: NoticeLevel = type === "warning" || type === "error" ? type : "info";
			onNotice({ text: String(message ?? ""), level, at: now() });
		} catch {
			// The stage is display only; Pi's notice must still show.
		}
		return (original as (...args: unknown[]) => void).apply(this, [message, type].slice(0, arguments.length));
	};
	try {
		host.notify = wrapped as NotifyHost["notify"];
		host[WRAPPED] = true;
	} catch {
		return false;
	}
	return host.notify === wrapped;
}

/** The notice to show at `now`: the newest one while it is younger than NOTICE_MS and has text. */
export function currentNotice(notice: Notice | null, now: number): Notice | null {
	if (!notice || notice.text.trim() === "" || now - notice.at >= NOTICE_MS) return null;
	return notice;
}
