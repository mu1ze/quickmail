type SearchFocusListener = () => void;

const listeners = new Set<SearchFocusListener>();
let pending = false;

export function onSearchFocus(listener: SearchFocusListener): () => void {
	listeners.add(listener);
	if (pending) {
		pending = false;
		listener();
	}
	return () => listeners.delete(listener);
}

export function requestSearchFocus() {
	if (listeners.size === 0) {
		pending = true;
		return;
	}
	for (const listener of listeners) listener();
}

/** Test helper so cases do not leak listeners or a pending flag. */
export function resetSearchFocus() {
	listeners.clear();
	pending = false;
}
