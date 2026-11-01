/**
 * Pi's prompts under game mode (S8). Pi announces a prompt with `ui_prompt_start` only when no other prompt is open, and
 * game mode is itself a `ui.custom` that stays open all session: every later select or confirm (the guard asking before
 * a `git push`, for example) counts as nested, no event comes, and the scene covered it. Every extension shares one ui
 * object, so wrapping its prompt methods once sees them all. Best effort: the prompt always runs as before.
 */

const PROMPTS = ["select", "confirm", "input", "editor"] as const;

const WRAPPED = Symbol.for("gentle-reef.prompts-wrapped");

type PromptHost = { [name: string]: unknown; [WRAPPED]?: true };

/** Wraps Pi's prompt methods once: `onPrompt(+1)` when one opens, `onPrompt(-1)` when it settles. False when it did not wrap. */
export function wrapPrompts(ui: object, onPrompt: (change: number) => void): boolean {
	const host = ui as PromptHost;
	if (host[WRAPPED]) return false;
	const tell = (change: number) => {
		try {
			onPrompt(change);
		} catch {
			// The stage is display only; the prompt must still run.
		}
	};
	let wrappedAny = false;
	try {
		for (const name of PROMPTS) {
			const original = host[name];
			if (typeof original !== "function") continue;
			host[name] = function (this: unknown, ...args: unknown[]) {
				tell(+1);
				let result: unknown;
				try {
					result = (original as (...args: unknown[]) => unknown).apply(this, args);
				} catch (error) {
					tell(-1);
					throw error;
				}
				return Promise.resolve(result).finally(() => tell(-1));
			};
			wrappedAny = true;
		}
		host[WRAPPED] = true;
	} catch {
		return false;
	}
	return wrappedAny;
}
