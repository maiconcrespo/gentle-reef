/**
 * Keeps the last result while its inputs stay the same (T10). Pi renders the whole screen on every keystroke; the scene
 * changes only with the session, so typing reuses the overlay's lines instead of wrapping and fitting the chat again.
 */
export function lastResult<T>(): (inputs: readonly unknown[], compute: () => T) => T {
	let last: { inputs: readonly unknown[]; value: T } | undefined;
	return (inputs, compute) => {
		if (last && last.inputs.length === inputs.length && last.inputs.every((input, i) => Object.is(input, inputs[i]))) return last.value;
		last = { inputs, value: compute() };
		return last.value;
	};
}
