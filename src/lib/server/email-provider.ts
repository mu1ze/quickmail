import type { AvailableDomain, EmailProviderKind, MailStatus } from '$lib/types';
import type { OutboundMailInput, OutboundMailResult } from './send-mail';

export type { EmailProviderKind };

export type ProviderDomain = {
	id: string;
	name: string;
	status: string;
	region?: string | null;
	sendingEnabled: boolean;
	receivingEnabled: boolean;
};

export type EmailProvider = {
	kind: EmailProviderKind;
	send(input: OutboundMailInput): Promise<OutboundMailResult>;
	listDomains(): Promise<ProviderDomain[]>;
	getDomain(id: string): Promise<ProviderDomain>;
	/** Provider id or hostname. Creates the domain at the provider when needed. */
	resolveDomain(nameOrId: string): Promise<ProviderDomain>;
};

export class ProviderError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'ProviderError';
		this.status = status;
		this.code = code;
	}
}

export function toAvailableDomain(domain: ProviderDomain, connected: boolean): AvailableDomain {
	return {
		id: domain.id,
		name: domain.name,
		status: domain.status,
		region: domain.region ?? null,
		can_send: domain.sendingEnabled,
		can_receive: domain.receivingEnabled,
		connected
	};
}

/** Outbound rows stay queued until Resend webhooks land; Cloudflare send() is already accepted. */
export function initialOutboundStatus(kind: EmailProviderKind): MailStatus {
	switch (kind) {
		case 'resend':
			return 'queued';
		case 'cloudflare':
			return 'sent';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function providerLabel(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'Resend';
		case 'cloudflare':
			return 'Cloudflare Email';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function parseMailDomains(value: string | undefined | null): string[] {
	if (!value?.trim()) return [];
	const seen = new Set<string>();
	const domains: string[] = [];

	for (const part of value.split(',')) {
		const name = normalizeDomainName(part);
		if (!name || seen.has(name)) continue;
		seen.add(name);
		domains.push(name);
	}

	return domains;
}

export function normalizeDomainName(value: string): string {
	return value.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
}

/** Hostname with a TLD. Rejects empty labels, IPs, and bare words. */
export function isValidDomainName(value: string): boolean {
	const name = normalizeDomainName(value);
	if (!name || name.length > 253 || !name.includes('.') || name.includes('..')) return false;
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name)) return false;
	return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
		name
	);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeProviderId(value: string): boolean {
	return UUID_RE.test(value.trim());
}
