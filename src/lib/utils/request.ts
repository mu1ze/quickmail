/** Keep failed HTTP responses from being mistaken for completed mailbox actions. */
export async function requireOk(response: Response): Promise<void> {
	if (response.ok) return;
	const body = await response.json().catch(() => null) as { error?: unknown } | null;
	throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status}). Please try again.`);
}

export function requestError(cause: unknown): string {
	return cause instanceof TypeError ? 'Could not connect. Check your connection and try again.' :
		cause instanceof Error ? cause.message : 'Could not complete this action. Please try again.';
}
