<script lang="ts">
	import { animate } from 'motion';
	import { prefersReducedMotion } from './motion';

	let {
		label = 'Hold to confirm',
		holdLabel = 'Keep holding',
		confirmLabel = 'Done',
		duration = 1400,
		disabled = false,
		onConfirm
	}: {
		label?: string;
		holdLabel?: string;
		confirmLabel?: string;
		duration?: number;
		disabled?: boolean;
		onConfirm: () => void | Promise<void>;
	} = $props();

	let phase = $state<'idle' | 'holding' | 'committed'>('idle');
	let fill = $state(0);
	let controls: { stop: () => void } | null = null;

	const shown = $derived(
		phase === 'committed' ? confirmLabel : phase === 'holding' ? holdLabel : label
	);

	function stop() {
		controls?.stop();
		controls = null;
	}

	function startHold() {
		if (disabled || phase === 'committed') return;
		phase = 'holding';
		stop();
		if (prefersReducedMotion()) {
			fill = 1;
			void commit();
			return;
		}
		const from = fill;
		controls = animate(from, 1, {
			duration: (duration * (1 - from)) / 1000,
			ease: 'linear',
			onUpdate: (value) => {
				fill = value;
			},
			onComplete: () => {
				void commit();
			}
		});
	}

	function abortHold() {
		if (phase !== 'holding') return;
		stop();
		phase = 'idle';
		const from = fill;
		controls = animate(from, 0, {
			duration: prefersReducedMotion() ? 0 : 0.28,
			ease: [0.23, 1, 0.32, 1],
			onUpdate: (value) => {
				fill = value;
			}
		});
	}

	async function commit() {
		if (phase === 'committed') return;
		stop();
		fill = 1;
		phase = 'committed';
		await onConfirm();
	}
</script>

<button
	type="button"
	class="hold"
	class:holding={phase === 'holding'}
	class:committed={phase === 'committed'}
	disabled={disabled || phase === 'committed'}
	aria-label={shown}
	onpointerdown={(event) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		startHold();
	}}
	onpointerup={abortHold}
	onpointercancel={abortHold}
	onlostpointercapture={abortHold}
>
	<span class="fill" style="transform: scaleX({fill})"></span>
	<span class="faces" aria-hidden="true">
		<span class="face measure">{label}</span>
		<span class="face measure">{holdLabel}</span>
		<span class="face measure">{confirmLabel}</span>
		<span class="face" class:on={phase === 'idle'}>{label}</span>
		<span class="face" class:on={phase === 'holding'}>{holdLabel}</span>
		<span class="face" class:on={phase === 'committed'}>{confirmLabel}</span>
	</span>
</button>

<style>
	.hold {
		position: relative;
		isolation: isolate;
		display: inline-grid;
		place-items: center;
		overflow: hidden;
		min-height: 2.5rem;
		padding: 0 1rem;
		border-radius: 9px;
		font-size: 13px;
		font-weight: 500;
		color: var(--tone-bad-fg);
		background: var(--color-surface);
		box-shadow: var(--mat-cap);
		touch-action: manipulation;
		-webkit-touch-callout: none;
		user-select: none;
	}

	.hold:disabled {
		opacity: 0.5;
	}

	.fill {
		position: absolute;
		inset: 0;
		z-index: 0;
		transform-origin: left center;
		background: color-mix(in srgb, var(--color-danger) 18%, var(--color-surface));
		pointer-events: none;
	}

	.faces {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
	}

	.face {
		grid-area: 1 / 1;
		white-space: nowrap;
		opacity: 0;
		transition: opacity 0.16s ease;
	}

	.face.measure {
		visibility: hidden;
		opacity: 1;
	}

	.face.on {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.face {
			transition: none;
		}
	}
</style>
