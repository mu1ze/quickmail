export const SIGNATURE_LAYOUTS = ['plain', 'stacked', 'photo', 'logo'] as const;
export type SignatureLayout = (typeof SIGNATURE_LAYOUTS)[number];

export const SIGNATURE_SOCIALS = ['linkedin', 'x', 'github', 'instagram'] as const;
export type SignatureSocialKind = (typeof SIGNATURE_SOCIALS)[number];

export type SignatureSocial = {
	kind: SignatureSocialKind;
	url: string;
};

export type SignatureConfig = {
	version: 1;
	layout: SignatureLayout;
	name: string;
	title: string;
	company: string;
	phone: string;
	website: string;
	accent: string;
	photoId: string | null;
	logoId: string | null;
	socials: SignatureSocial[];
	/** Used when layout is `plain`. */
	text: string;
};

export const DEFAULT_SIGNATURE_ACCENT = '#1a1a1a';
export const MAX_SIGNATURE_FIELD_LENGTH = 120;
export const MAX_SIGNATURE_URL_LENGTH = 200;
export const MAX_SIGNATURE_TEXT_LENGTH = 4000;
export const MAX_SIGNATURE_SOCIALS = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCENT_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const SOCIAL_LABELS: Record<SignatureSocialKind, string> = {
	linkedin: 'LinkedIn',
	x: 'X',
	github: 'GitHub',
	instagram: 'Instagram'
};

export const EMPTY_SIGNATURE: SignatureConfig = {
	version: 1,
	layout: 'stacked',
	name: '',
	title: '',
	company: '',
	phone: '',
	website: '',
	accent: DEFAULT_SIGNATURE_ACCENT,
	photoId: null,
	logoId: null,
	socials: [],
	text: ''
};

export function escapeSignatureHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function clip(value: string, max: number): string {
	return value.trim().slice(0, max);
}

export function isSignatureAssetId(value: string | null | undefined): value is string {
	return typeof value === 'string' && UUID_RE.test(value);
}

export function sanitizeAccent(value: string): string {
	const trimmed = value.trim();
	if (!ACCENT_RE.test(trimmed)) return DEFAULT_SIGNATURE_ACCENT;
	if (trimmed.length === 4) {
		const [, r, g, b] = trimmed;
		return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
	}
	return trimmed.toLowerCase();
}

export function sanitizeHttpUrl(value: string): string {
	const trimmed = clip(value, MAX_SIGNATURE_URL_LENGTH);
	if (!trimmed) return '';
	let url = trimmed;
	if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
		if (parsed.username || parsed.password) return '';
		return parsed.toString();
	} catch {
		return '';
	}
}

function sanitizeAssetId(value: unknown): string | null {
	return typeof value === 'string' && isSignatureAssetId(value) ? value : null;
}

function isLayout(value: unknown): value is SignatureLayout {
	return typeof value === 'string' && (SIGNATURE_LAYOUTS as readonly string[]).includes(value);
}

function isSocialKind(value: unknown): value is SignatureSocialKind {
	return typeof value === 'string' && (SIGNATURE_SOCIALS as readonly string[]).includes(value);
}

export function sanitizeSignatureConfig(input: Partial<SignatureConfig> | null | undefined): SignatureConfig {
	const socials: SignatureSocial[] = [];
	if (Array.isArray(input?.socials)) {
		for (const entry of input.socials) {
			if (!entry || !isSocialKind(entry.kind)) continue;
			const url = sanitizeHttpUrl(entry.url ?? '');
			if (!url) continue;
			if (socials.some((social) => social.kind === entry.kind)) continue;
			socials.push({ kind: entry.kind, url });
			if (socials.length >= MAX_SIGNATURE_SOCIALS) break;
		}
	}

	return {
		version: 1,
		layout: isLayout(input?.layout) ? input.layout : 'stacked',
		name: clip(input?.name ?? '', MAX_SIGNATURE_FIELD_LENGTH),
		title: clip(input?.title ?? '', MAX_SIGNATURE_FIELD_LENGTH),
		company: clip(input?.company ?? '', MAX_SIGNATURE_FIELD_LENGTH),
		phone: clip(input?.phone ?? '', MAX_SIGNATURE_FIELD_LENGTH),
		website: sanitizeHttpUrl(input?.website ?? ''),
		accent: sanitizeAccent(input?.accent ?? ''),
		photoId: sanitizeAssetId(input?.photoId),
		logoId: sanitizeAssetId(input?.logoId),
		socials,
		text: (input?.text ?? '').replace(/\r\n?/g, '\n').trimEnd().slice(0, MAX_SIGNATURE_TEXT_LENGTH).trim()
	};
}

export function isSignatureEmpty(config: SignatureConfig): boolean {
	if (config.layout === 'plain') return !config.text;
	return (
		!config.name &&
		!config.title &&
		!config.company &&
		!config.phone &&
		!config.website &&
		!config.photoId &&
		!config.logoId &&
		config.socials.length === 0 &&
		!config.text
	);
}

/** Stored form: compact JSON for templates, raw text for a plain-only sign-off. */
export function serializeSignatureConfig(config: SignatureConfig): string {
	const sanitized = sanitizeSignatureConfig(config);
	if (isSignatureEmpty(sanitized)) return '';
	if (sanitized.layout === 'plain' && !hasStructuredFields(sanitized)) {
		return sanitized.text;
	}
	return JSON.stringify(sanitized);
}

function hasStructuredFields(config: SignatureConfig): boolean {
	return Boolean(
		config.name ||
			config.title ||
			config.company ||
			config.phone ||
			config.website ||
			config.photoId ||
			config.logoId ||
			config.socials.length > 0
	);
}

export function looksLikeSignatureJson(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.startsWith('{') && trimmed.endsWith('}');
}

export function parseSignatureConfig(raw: string | null | undefined): SignatureConfig {
	const trimmed = (raw ?? '').trim();
	if (!trimmed) return { ...EMPTY_SIGNATURE };
	if (looksLikeSignatureJson(trimmed)) {
		try {
			const parsed = JSON.parse(trimmed) as Partial<SignatureConfig>;
			if (parsed && (parsed.version === 1 || isLayout(parsed.layout))) {
				return sanitizeSignatureConfig(parsed);
			}
		} catch {
			/* fall through to plain text */
		}
	}
	return sanitizeSignatureConfig({ ...EMPTY_SIGNATURE, layout: 'plain', text: trimmed });
}

export function signatureAssetUrl(origin: string, assetId: string): string {
	const base = origin.replace(/\/$/, '');
	return `${base}/s/${assetId}`;
}

function linkStyle(accent: string): string {
	return `color:${accent};text-decoration:none;`;
}

function fontStack(): string {
	return "Arial, Helvetica, sans-serif";
}

function displayHost(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, ''));
	} catch {
		return url.replace(/^https?:\/\//, '');
	}
}

function detailsHtml(config: SignatureConfig): string {
	const accent = config.accent;
	const font = fontStack();
	const rows: string[] = [];

	if (config.name) {
		rows.push(
			`<div style="font-family:${font};font-size:15px;line-height:20px;font-weight:bold;color:${accent};">${escapeSignatureHtml(config.name)}</div>`
		);
	}

	const role = [config.title, config.company].filter(Boolean).join(' · ');
	if (role) {
		rows.push(
			`<div style="font-family:${font};font-size:13px;line-height:18px;color:#555555;">${escapeSignatureHtml(role)}</div>`
		);
	}

	if (config.phone) {
		const tel = config.phone.replace(/[^\d+]/g, '');
		rows.push(
			`<div style="font-family:${font};font-size:13px;line-height:18px;color:#555555;"><a href="tel:${escapeSignatureHtml(tel)}" style="${linkStyle(accent)}">${escapeSignatureHtml(config.phone)}</a></div>`
		);
	}

	if (config.website) {
		rows.push(
			`<div style="font-family:${font};font-size:13px;line-height:18px;"><a href="${escapeSignatureHtml(config.website)}" style="${linkStyle(accent)}">${escapeSignatureHtml(displayHost(config.website))}</a></div>`
		);
	}

	if (config.socials.length > 0) {
		const links = config.socials
			.map(
				(social) =>
					`<a href="${escapeSignatureHtml(social.url)}" style="${linkStyle(accent)}">${escapeSignatureHtml(SOCIAL_LABELS[social.kind])}</a>`
			)
			.join(
				`<span style="font-family:${font};font-size:13px;color:#888888;"> · </span>`
			);
		rows.push(`<div style="font-family:${font};font-size:13px;line-height:18px;">${links}</div>`);
	}

	return rows.join('');
}

function detailsText(config: SignatureConfig): string {
	const lines: string[] = [];
	if (config.name) lines.push(config.name);
	const role = [config.title, config.company].filter(Boolean).join(' · ');
	if (role) lines.push(role);
	if (config.phone) lines.push(config.phone);
	if (config.website) lines.push(config.website);
	for (const social of config.socials) {
		lines.push(`${SOCIAL_LABELS[social.kind]}: ${social.url}`);
	}
	return lines.join('\n');
}

function wrapTable(inner: string): string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${fontStack()};"><tbody>${inner}</tbody></table>`;
}

export function compileSignature(
	config: SignatureConfig,
	origin = ''
): { html: string; text: string } {
	const sanitized = sanitizeSignatureConfig(config);
	if (isSignatureEmpty(sanitized)) return { html: '', text: '' };

	if (sanitized.layout === 'plain') {
		const text = sanitized.text;
		return { html: escapeSignatureHtml(text).replaceAll('\n', '<br>\n'), text };
	}

	const details = detailsHtml(sanitized);
	const text = detailsText(sanitized);
	if (!details) return { html: '', text: '' };

	const photoUrl =
		sanitized.layout === 'photo' && sanitized.photoId && origin
			? signatureAssetUrl(origin, sanitized.photoId)
			: '';
	const logoUrl =
		sanitized.layout === 'logo' && sanitized.logoId && origin
			? signatureAssetUrl(origin, sanitized.logoId)
			: '';

	if (photoUrl) {
		const html = wrapTable(
			`<tr><td valign="top" style="padding-right:14px;"><img src="${escapeSignatureHtml(photoUrl)}" width="72" height="72" alt="" style="display:block;border:0;width:72px;height:72px;object-fit:cover;"></td><td valign="top">${details}</td></tr>`
		);
		return { html, text };
	}

	if (logoUrl) {
		const html = wrapTable(
			`<tr><td style="padding-bottom:10px;"><img src="${escapeSignatureHtml(logoUrl)}" alt="" height="36" style="display:block;border:0;max-height:36px;height:36px;width:auto;"></td></tr><tr><td>${details}</td></tr>`
		);
		return { html, text };
	}

	return { html: wrapTable(`<tr><td>${details}</td></tr>`), text };
}
