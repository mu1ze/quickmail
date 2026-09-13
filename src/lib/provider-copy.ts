import type { EmailProviderKind } from '$lib/types';

export function providerName(kind: EmailProviderKind): string {
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

export function missingProviderTitle(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'Resend API key missing';
		case 'cloudflare':
			return 'Cloudflare Email is not configured';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function missingProviderHint(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'wrangler secret put RESEND_API_KEY';
		case 'cloudflare':
			return 'EMAIL_PROVIDER=cloudflare\nCLOUDFLARE_MAIL_DOMAINS=yourdomain.com';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function noDomainsTitle(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'No domains in this Resend account';
		case 'cloudflare':
			return 'No domains in CLOUDFLARE_MAIL_DOMAINS';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function noDomainsBody(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'Type a domain below to create it in Resend, or add it at resend.com/domains and reload.';
		case 'cloudflare':
			return 'Type a domain you have onboarded in Cloudflare Email Service. You can also list seed domains in CLOUDFLARE_MAIL_DOMAINS.';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function addDomainHint(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'Creates the domain in your Resend account if it is not there yet. Add the DNS records Resend shows, including MX, then Re-sync.';
		case 'cloudflare':
			return "Onboard the domain in Email Sending and Email Routing first, then add it here. Point Routing's catch-all at this Worker.";
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function domainPickerSubtitle(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'These are the domains your Resend account can send and receive on. Pick the one you want to use — you can add more later.';
		case 'cloudflare':
			return 'These are the domains listed in CLOUDFLARE_MAIL_DOMAINS. Pick one, or type another hostname you have onboarded in Cloudflare Email.';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function onboardingSubtitle(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'Pick the domains from your Resend account that you want in this dashboard.';
		case 'cloudflare':
			return 'Pick the domains from CLOUDFLARE_MAIL_DOMAINS that you want in this dashboard.';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function receivingHint(kind: EmailProviderKind, domainName: string): string {
	switch (kind) {
		case 'resend':
			return `Receiving isn't enabled on ${domainName} yet — you can send, but inbound mail won't arrive until you add the MX record in Resend.`;
		case 'cloudflare':
			return `Receiving isn't enabled on ${domainName} yet — point Email Routing's catch-all at this Worker.`;
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}
