/**
 * The dialog's scroll keys before Pi's viewport (S9). Pi 1.4's alt-screen renderer adds its input listener first and
 * takes PgUp/PgDn to scroll the history, which the scene covers; shift+up/down pass. pi-tui keeps listeners in a Set
 * (private in the types, present at runtime) and calls them in insertion order, so the scroll listener is moved to the
 * front. It consumes only while a reply overflows the dialog; otherwise the keys reach Pi as before.
 */
export function putListenerFirst(tui: object, listener: unknown): boolean {
	const listeners = (tui as { inputListeners?: unknown }).inputListeners;
	if (!(listeners instanceof Set) || !listeners.has(listener)) return false;
	const others = [...listeners].filter(other => other !== listener);
	listeners.clear();
	listeners.add(listener);
	for (const other of others) listeners.add(other);
	return true;
}
