import { showUndo } from './undo';

const DELAY_MS = 10_000;

type QueuedSend = {
	send: () => Promise<void>;
	onError?: (message: string) => void;
	timer: ReturnType<typeof setTimeout>;
};

let queued: QueuedSend | null = null;
let flushing = false;

/** Gmail-style undo send: wait a beat, then actually POST. */
export function queueMailSend(input: {
	send: () => Promise<void>;
	undo: () => void;
	onError?: (message: string) => void;
}): void {
	cancelQueuedSend();
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
	if (!queued || flushing) return;
	const job = queued;
	queued = null;
	clearTimeout(job.timer);
	flushing = true;
	try {
		await job.send();
		showUndo('Sent');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to send';
		showUndo(message);
		job.onError?.(message);
	} finally {
		flushing = false;
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
