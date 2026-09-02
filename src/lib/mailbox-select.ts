export function toggleSelection(selected: string[], id: string): string[] {
	return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
}

/** In Select mode a row tap toggles instead of opening the thread. */
export function handleMailboxRowClick(
	selectMode: boolean,
	preventDefault: () => void
): 'toggle' | 'open' {
	if (!selectMode) return 'open';
	preventDefault();
	return 'toggle';
}
