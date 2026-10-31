/**
 * The game dialog as the selector (T4e). While a single-select ask_user_choice question is open, the overlay consumes
 * up/down to move its own ▶, so Pi's choice list stays on its first item. Enter is swallowed and replayed as
 * "down × index, Enter" into Pi's list, which then picks exactly the option the dialog shows. Pi's list wraps at both ends, and so does this.
 */

export type SelectorKey = "up" | "down" | "enter" | "other";

export interface SelectorStep {
	/** Swallow the key: Pi's list never sees it. */
	readonly consume: boolean;
	/** Keys to replay into Pi, one per entry (Pi handles one key per input). */
	readonly forward?: readonly string[];
	/** The question is answered from the dialog; keys go to Pi again. */
	readonly done?: boolean;
	/** "Other…" was chosen: Pi's free-text editor takes the keys and needs room. */
	readonly editing?: boolean;
}

export interface ChoiceSelector {
	index(): number;
	items(): number;
	active(): boolean;
	key(key: SelectorKey): SelectorStep;
}

const DOWN = "\x1b[B";
const ENTER = "\r";

export function createChoiceSelector(question: { options: number; custom: boolean }): ChoiceSelector {
	const items = Math.max(1, question.options + (question.custom ? 1 : 0));
	let index = 0;
	let active = true;
	return {
		index: () => index,
		items: () => items,
		active: () => active,
		key(key) {
			if (!active || key === "other") return { consume: false };
			if (key === "up") { index = index === 0 ? items - 1 : index - 1; return { consume: true }; }
			if (key === "down") { index = index === items - 1 ? 0 : index + 1; return { consume: true }; }
			active = false;
			return { consume: true, forward: [...Array.from({ length: index }, () => DOWN), ENTER], done: true, editing: question.custom && index === items - 1 };
		},
	};
}
