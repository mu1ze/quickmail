export const PBKDF2_ITERATIONS = 600_000;
const PASSWORD_ALGORITHM = 'pbkdf2_sha256';

function toBase64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);

	return crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: salt as BufferSource,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		keyMaterial,
		256
	);
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = new Uint8Array(await deriveKey(password, salt));
	return `${PASSWORD_ALGORITHM}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	let saltPart: string;
	let hashPart: string;
	let iterations = PBKDF2_ITERATIONS;
	const versioned = stored.split('$');
	if (versioned.length === 4) {
		if (versioned[0] !== PASSWORD_ALGORITHM) return false;
		iterations = Number(versioned[1]);
		if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) {
			return false;
		}
		[, , saltPart, hashPart] = versioned;
	} else {
		// Legacy hashes used 100,000 iterations and `salt:hash`.
		[saltPart, hashPart] = stored.split(':');
		iterations = 100_000;
	}
	if (!saltPart || !hashPart) return false;

	let salt: Uint8Array;
	let expected: Uint8Array;
	try {
		salt = fromBase64(saltPart);
		expected = fromBase64(hashPart);
	} catch {
		return false;
	}
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const actual = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
			keyMaterial,
			256
		)
	);

	if (actual.length !== expected.length) return false;

	let mismatch = 0;
	for (let i = 0; i < actual.length; i++) {
		mismatch |= actual[i] ^ expected[i];
	}
	return mismatch === 0;
}

export function passwordNeedsRehash(stored: string): boolean {
	return !stored.startsWith(`${PASSWORD_ALGORITHM}$${PBKDF2_ITERATIONS}$`);
}

export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return toBase64(new Uint8Array(digest));
}

export function createSessionToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return toBase64(bytes);
}
