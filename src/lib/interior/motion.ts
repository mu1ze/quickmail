/** Interior springs — destination still arrives when motion is off. */

export const CELL = { type: 'spring', stiffness: 520, damping: 34, mass: 0.45 } as const;
export const CROSSFADE = { type: 'spring', stiffness: 260, damping: 34, mass: 0.8 } as const;
export const DISCLOSE = { type: 'spring', stiffness: 150, damping: 27, mass: 1 } as const;
export const INDICATOR = { type: 'spring', stiffness: 620, damping: 42, mass: 0.35 } as const;

export function prefersReducedMotion(): boolean {
	if (typeof matchMedia !== 'function') return false;
	return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionDuration(ms: number): number {
	return prefersReducedMotion() ? 0 : ms;
}
