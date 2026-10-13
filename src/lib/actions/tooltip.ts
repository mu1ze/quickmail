import type { Action } from 'svelte/action';

let nextId = 0;

/** A viewport-contained tooltip that works with both a mouse and keyboard. */
export const tooltip: Action<HTMLElement, string> = (node, label) => {
	const tip = document.createElement('div');
	tip.id = `action-tooltip-${++nextId}`;
	tip.className = 'action-tooltip';
	tip.setAttribute('role', 'tooltip');
	tip.textContent = label;
	const events = new AbortController();
	const options = { signal: events.signal };
	let timer: ReturnType<typeof setTimeout> | undefined;
	let hovered = false;
	let focused = false;
	let tipHovered = false;
	let dismissed = false;

	function clearTimer() {
		clearTimeout(timer);
		timer = undefined;
	}

	function hide() {
		clearTimer();
		tip.remove();
		const descriptions = (node.getAttribute('aria-describedby') ?? '')
			.split(/\s+/).filter((id) => id && id !== tip.id);
		if (descriptions.length) node.setAttribute('aria-describedby', descriptions.join(' '));
		else node.removeAttribute('aria-describedby');
		tipHovered = false;
	}

	function position() {
		const anchor = node.getBoundingClientRect();
		const bounds = tip.getBoundingClientRect();
		const left = Math.max(8, Math.min(anchor.left + (anchor.width - bounds.width) / 2,
			window.innerWidth - bounds.width - 8));
		const top = anchor.bottom + bounds.height + 8 <= window.innerHeight
			? anchor.bottom + 6 : Math.max(8, anchor.top - bounds.height - 6);
		tip.style.left = `${left}px`;
		tip.style.top = `${top}px`;
	}

	function show() {
		clearTimer();
		if (dismissed || !label || node.matches(':disabled') || !node.isConnected) return;
		document.body.append(tip);
		const descriptions = (node.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
		if (!descriptions.includes(tip.id)) descriptions.push(tip.id);
		node.setAttribute('aria-describedby', descriptions.join(' '));
		position();
	}

	function leave() {
		clearTimer();
		if (!hovered && !focused && !tipHovered) {
			dismissed = false;
			timer = setTimeout(hide, 120);
		}
	}

	node.addEventListener('pointerenter', (event) => {
		if (event.pointerType === 'touch') return;
		dismissed = false;
		hovered = true;
		clearTimer();
		timer = setTimeout(show, 300);
	}, options);
	node.addEventListener('pointerleave', () => { hovered = false; leave(); }, options);
	node.addEventListener('focus', () => {
		dismissed = false;
		focused = node.matches(':focus-visible');
		if (focused) show();
	}, options);
	node.addEventListener('blur', () => { focused = false; leave(); }, options);
	node.addEventListener('click', () => { dismissed = true; hide(); }, options);
	tip.addEventListener('pointerenter', () => { tipHovered = true; clearTimer(); }, options);
	tip.addEventListener('pointerleave', () => { tipHovered = false; leave(); }, options);
	window.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && (tip.isConnected || timer)) {
			dismissed = true;
			hide();
		}
	}, options);
	window.addEventListener('scroll', hide, { ...options, capture: true });
	window.addEventListener('resize', hide, options);

	return {
		update(nextLabel) {
			label = nextLabel;
			tip.textContent = label;
			if (!label) hide();
			else if (tip.isConnected) position();
		},
		destroy() { events.abort(); hide(); }
	};
};
