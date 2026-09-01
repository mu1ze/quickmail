type SearchFocusListener = () => void;

const listeners = new Set<SearchFocusListener>();

export function onSearchFocus(listener: SearchFocusListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function requestSearchFocus() {
	for (const listener of listeners) listener();
}
