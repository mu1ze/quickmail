import type { Action } from 'svelte/action';

/** Reuse a row's options for right-click, keyboard context menus and touch holds. */
export const mailboxContextMenu: Action<HTMLElement, () => void> = (node, open) => {
	const events = new AbortController();
	const options = { signal: events.signal };
	let timer: ReturnType<typeof setTimeout> | undefined;
	let releaseTimer: ReturnType<typeof setTimeout> | undefined;
	let pointer: { id: number; x: number; y: number } | undefined;
	let held = false;

	function cancel() {
		clearTimeout(timer);
		timer = undefined;
		pointer = undefined;
	}

	function isRowContent(target: EventTarget | null) {
		return target instanceof Element && !target.closest('button, input, select, textarea, dialog, [role="menu"]');
	}

	node.addEventListener('contextmenu', (event) => {
		if (!isRowContent(event.target)) return;
		event.preventDefault();
		cancel();
		if (!held) open();
	}, options);
	node.addEventListener('keydown', (event) => {
		if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && isRowContent(event.target)) {
			event.preventDefault();
			open();
		}
	}, options);
	node.addEventListener('pointerdown', (event) => {
		if (event.pointerType !== 'touch' || !isRowContent(event.target)) return;
		if (!event.isPrimary) { cancel(); return; }
		cancel();
		held = false;
		clearTimeout(releaseTimer);
		pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
		timer = setTimeout(() => { held = true; timer = undefined; open(); }, 550);
	}, options);
	window.addEventListener('pointerdown', (event) => {
		// A new gesture is deliberate; only the release of the held gesture is suppressed.
		if (held) { held = false; clearTimeout(releaseTimer); }
		if (pointer && pointer.id !== event.pointerId) cancel();
	}, { ...options, capture: true });
	window.addEventListener('pointermove', (event) => {
		if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) cancel();
	}, options);
	function release(event: PointerEvent) {
		if (pointer?.id !== event.pointerId) return;
		cancel();
		// Suppress the synthetic tap after a hold, including a tap on the new backdrop.
		if (held) releaseTimer = setTimeout(() => { held = false; }, 700);
	}
	window.addEventListener('pointerup', release, options);
	window.addEventListener('pointercancel', (event) => {
		if (pointer?.id === event.pointerId) { cancel(); held = false; }
	}, options);
	window.addEventListener('click', (event) => {
		if (!held) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		held = false;
	}, { ...options, capture: true });
	window.addEventListener('scroll', cancel, { ...options, capture: true });
	window.addEventListener('blur', () => { cancel(); held = false; }, options);
	document.addEventListener('visibilitychange', () => { if (document.hidden) { cancel(); held = false; } }, options);

	return {
		update(next) { open = next; },
		destroy() { events.abort(); cancel(); clearTimeout(releaseTimer); }
	};
};

/** Keep the existing options popup visible even for rows at the screen's edge. */
export const rowMenuPosition: Action<HTMLElement> = (node) => {
	const anchor = node.closest('.card-actions');
	const events = new AbortController();
	const options = { signal: events.signal };
	function position() {
		if (!anchor) return;
		const rect = anchor.getBoundingClientRect();
		const bounds = node.getBoundingClientRect();
		node.style.left = `${Math.max(8, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
		node.style.top = `${Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - bounds.height - 8))}px`;
	}
	node.addEventListener('keydown', (event) => {
		if (event.target instanceof Element && event.target.closest('input, textarea, select, dialog')) return;
		const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
			.filter((button) => button.getClientRects().length > 0);
		const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
		let next: number;
		if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
		else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = buttons.length - 1;
		else return;
		event.preventDefault();
		event.stopPropagation();
		buttons[next]?.focus();
	}, options);
	position();
	const resize = new ResizeObserver(position);
	resize.observe(node);
	window.addEventListener('resize', position, options);
	window.addEventListener('scroll', position, { ...options, capture: true });
	node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
	return { destroy() { events.abort(); resize.disconnect(); } };
};
