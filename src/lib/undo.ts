import { writable } from 'svelte/store';

export type UndoToast = {
	message: string;
	undo?: () => void | Promise<void>;
	/** Hide the undo button — used for "Sending…" while the timer runs. */
	undoLabel?: string;
};

export const undoToast = writable<UndoToast | null>(null);

let hideTimer: ReturnType<typeof setTimeout> | null = null;
let currentUndo: (() => void | Promise<void>) | undefined;

export function showUndo(message: string, undo?: () => void | Promise<void>, ms = 8_000): void {
	if (hideTimer) clearTimeout(hideTimer);
	currentUndo = undo;
	undoToast.set({ message, undo, undoLabel: undo ? 'Undo' : undefined });
	hideTimer = setTimeout(() => {
		undoToast.set(null);
		currentUndo = undefined;
		hideTimer = null;
	}, ms);
}

export function dismissUndo(): void {
	if (hideTimer) clearTimeout(hideTimer);
	hideTimer = null;
	currentUndo = undefined;
	undoToast.set(null);
}

export async function runUndo(): Promise<void> {
	const undo = currentUndo;
	dismissUndo();
	if (undo) await undo();
}
