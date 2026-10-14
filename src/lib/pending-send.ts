import { showUndo } from './undo';

const DELAY_MS = 10_000;

type QueuedSend = {
	send: () => Promise<void | string>;
	onError?: (message: string) => void;
	timer: ReturnType<typeof setTimeout>;
};

let queued: QueuedSend | null = null;

/** Gmail-style undo send: wait a beat, then actually POST. */
export function queueMailSend(input: {
	/** May resolve to a warning to show instead of "Sent" (the mail still went out). */
	send: () => Promise<void | string>;
	undo: () => void;
	onError?: (message: string) => void;
}): void {
	// A second message must never silently replace a first one still inside its
	// undo window: send the earlier one now, then queue this one.
	if (queued) void flushQueuedSend();
	queued = {
		send: input.send,
		onError: input.onError,
		timer: setTimeout(() => {
			void flushQueuedSend();
		}, DELAY_MS)
	};
	showUndo(
		'Sending…',
		() => {
			cancelQueuedSend();
			input.undo();
		},
		DELAY_MS
	);
}

export function cancelQueuedSend(): void {
	if (!queued) return;
	clearTimeout(queued.timer);
	queued = null;
}

export async function flushQueuedSend(): Promise<void> {
	if (!queued) return;
	const job = queued;
	queued = null;
	clearTimeout(job.timer);
	try {
		const warning = await job.send();
		showUndo(typeof warning === 'string' && warning ? warning : 'Sent');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to send';
		showUndo(message);
		job.onError?.(message);
	}
}

export function hasQueuedSend(): boolean {
	return queued !== null;
}

/** Closing the tab should still send — undo is only useful while the app is open. */
export function bindPendingSendFlush(): () => void {
	const onHide = () => {
		if (queued) void flushQueuedSend();
	};
	window.addEventListener('pagehide', onHide);
	return () => window.removeEventListener('pagehide', onHide);
}
