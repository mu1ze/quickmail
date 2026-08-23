import { readPublicAppOrigin } from './brrr';

/** Prefer PUBLIC_APP_URL so signature images keep working when the request host differs. */
export function resolvePublicOrigin(
	env: { PUBLIC_APP_URL?: string } | undefined,
	fallbackOrigin: string
): string {
	return readPublicAppOrigin(env?.PUBLIC_APP_URL) ?? fallbackOrigin.replace(/\/$/, '');
}
