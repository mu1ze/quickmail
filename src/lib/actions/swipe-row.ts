export type SwipeOptions = {
	left: boolean;
	right: boolean;
	onSwipe: (direction: 'left' | 'right') => void;
};

const COMMIT = 96;
const LOCK = 10;

/**
 * Apple Mail style row swipe for touch and pen input. Sets --swipe-x on the
 * element while dragging and --swipe-progress (0..1) toward the commit point;
 * vertical scrolling is left to the browser until the gesture is clearly horizontal.
 */
export function swipeRow(node: HTMLElement, initial: SwipeOptions) {
	let options = initial;
	let startX = 0, startY = 0, pointer = -1, dragging = false, moved = false;

	const reset = () => {
		node.classList.remove('swiping');
		node.style.removeProperty('--swipe-x');
		node.style.removeProperty('--swipe-progress');
		node.removeAttribute('data-swipe');
	};

	function down(event: PointerEvent) {
		if (event.pointerType === 'mouse' || !event.isPrimary) return;
		if ((event.target as Element).closest('button, input, select')) return;
		pointer = event.pointerId; startX = event.clientX; startY = event.clientY; dragging = false; moved = false;
	}
	function move(event: PointerEvent) {
		if (event.pointerId !== pointer) return;
		const dx = event.clientX - startX, dy = event.clientY - startY;
		if (!dragging) {
			if (Math.abs(dy) > LOCK && Math.abs(dy) > Math.abs(dx)) { pointer = -1; return; }
			if (Math.abs(dx) < LOCK || Math.abs(dx) < Math.abs(dy) * 1.5) return;
			dragging = true; moved = true;
			try { node.setPointerCapture(event.pointerId); } catch { /* gesture still works without capture */ }
			node.classList.add('swiping');
		}
		const allowed = dx < 0 ? options.left : options.right;
		// Resist when the action is unavailable, and ease past the commit point.
		const eased = allowed ? dx : dx * 0.15;
		const clamped = Math.sign(eased) * Math.min(Math.abs(eased), COMMIT * 2.2);
		node.style.setProperty('--swipe-x', `${clamped}px`);
		node.style.setProperty('--swipe-progress', String(Math.min(1, Math.abs(clamped) / COMMIT)));
		node.dataset.swipe = clamped < 0 ? 'left' : 'right';
	}
	function up(event: PointerEvent) {
		if (event.pointerId !== pointer) return;
		pointer = -1;
		if (!dragging) return;
		const dx = event.clientX - startX;
		const direction = dx < 0 ? 'left' : 'right';
		const commit = Math.abs(dx) >= COMMIT && (direction === 'left' ? options.left : options.right);
		dragging = false;
		reset();
		if (commit) options.onSwipe(direction);
	}
	function cancel(event: PointerEvent) {
		if (event.pointerId !== pointer) return;
		pointer = -1; dragging = false; reset();
	}
	// A completed swipe must not also open the message.
	function click(event: MouseEvent) {
		if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; }
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('click', click, true);
	return {
		update(next: SwipeOptions) { options = next; },
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('click', click, true);
		}
	};
}
