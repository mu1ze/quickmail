import { isLiveDate, isValidTimeZone, liveStatusPath, pickLiveState } from './signature-live';

export const SIGNATURE_LAYOUTS = ['plain', 'stacked', 'photo', 'logo'] as const;
export type SignatureLayout = (typeof SIGNATURE_LAYOUTS)[number];

export const SIGNATURE_SOCIALS = ['linkedin', 'x', 'github', 'instagram'] as const;
export type SignatureSocialKind = (typeof SIGNATURE_SOCIALS)[number];

/**
 * Motion applied to the signature's photo/logo image. Kept to a small, curated
 * set because the CSS is emitted verbatim into outbound mail — a fixed enum
 * means no user string ever reaches a stylesheet.
 */
export const SIGNATURE_ANIMATIONS = ['none', 'halo', 'ripple', 'float', 'shine', 'glow', 'pulse', 'wave', 'spin'] as const;
export type SignatureAnimation = (typeof SIGNATURE_ANIMATIONS)[number];

/** Background the animated images are rendered against (GIF has no soft transparency). */
export const SIGNATURE_MATTES = ['light', 'dark'] as const;
export type SignatureMatte = (typeof SIGNATURE_MATTES)[number];

export const SIGNATURE_SCRIPT_FONTS = ['vibes', 'allura', 'caveat', 'apple'] as const;
export type SignatureScriptFont = (typeof SIGNATURE_SCRIPT_FONTS)[number];

/**
 * An image rendered in the browser (animated GIF or PNG) and stored as a
 * signature asset. `key` fingerprints the inputs it was rendered from, so the
 * editor knows when it is stale.
 */
export type BakedImage = { id: string; w: number; h: number; key: string };

export type SignatureScript = { enabled: boolean; font: SignatureScriptFont; loop: boolean };

export type SignatureLive = {
	enabled: boolean;
	tz: string;
	start: number;
	end: number;
	days: number[];
	city: string;
	oooFrom: string;
	oooTo: string;
};

export type SignatureLiveImages = { available: BakedImage | null; away: BakedImage | null; ooo: BakedImage | null };

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
	/** Motion applied to the photo/logo image (ignored by imageless layouts). */
	animation: SignatureAnimation;
	socials: SignatureSocial[];
	/** Used when layout is `plain`. */
	text: string;
	matte: SignatureMatte;
	/** The photo/logo with its animation baked into a GIF, so it moves in Gmail and Outlook too. */
	motion: BakedImage | null;
	script: SignatureScript;
	/** The name written out in a script font, revealed stroke by stroke. */
	scriptImage: BakedImage | null;
	live: SignatureLive;
	liveImages: SignatureLiveImages;
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
	animation: 'none',
	socials: [],
	text: '',
	matte: 'light',
	motion: null,
	script: { enabled: false, font: 'vibes', loop: false },
	scriptImage: null,
	live: { enabled: false, tz: 'UTC', start: 9 * 60, end: 17 * 60, days: [1, 2, 3, 4, 5], city: '', oooFrom: '', oooTo: '' },
	liveImages: { available: null, away: null, ooo: null }
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

function isAnimation(value: unknown): value is SignatureAnimation {
	return typeof value === 'string' && (SIGNATURE_ANIMATIONS as readonly string[]).includes(value);
}

function sanitizeBaked(value: unknown): BakedImage | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Partial<BakedImage>;
	if (!isSignatureAssetId(raw.id ?? null)) return null;
	const w = Math.round(Number(raw.w));
	const h = Math.round(Number(raw.h));
	if (!(w > 0 && w <= 600 && h > 0 && h <= 300)) return null;
	const key = typeof raw.key === 'string' ? raw.key.slice(0, 200) : '';
	return { id: raw.id as string, w, h, key };
}

function sanitizeMinutes(value: unknown, fallback: number): number {
	const n = Math.round(Number(value));
	return Number.isFinite(n) && n >= 0 && n <= 1440 ? n - (n % 15) : fallback;
}

function sanitizeLive(input: Partial<SignatureLive> | undefined): SignatureLive {
	const base = EMPTY_SIGNATURE.live;
	const days = Array.isArray(input?.days)
		? [...new Set(input.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
		: base.days;
	const tz = typeof input?.tz === 'string' && isValidTimeZone(input.tz) ? input.tz : base.tz;
	let oooFrom = typeof input?.oooFrom === 'string' && isLiveDate(input.oooFrom) ? input.oooFrom : '';
	let oooTo = typeof input?.oooTo === 'string' && isLiveDate(input.oooTo) ? input.oooTo : '';
	if (!oooFrom || !oooTo || oooFrom > oooTo) oooFrom = oooTo = '';
	return {
		enabled: input?.enabled === true,
		tz,
		start: sanitizeMinutes(input?.start, base.start),
		end: sanitizeMinutes(input?.end, base.end),
		days,
		city: clip(typeof input?.city === 'string' ? input.city : '', 40),
		oooFrom,
		oooTo
	};
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
		animation: isAnimation(input?.animation) ? input.animation : 'none',
		socials,
		text: (input?.text ?? '').replace(/\r\n?/g, '\n').trimEnd().slice(0, MAX_SIGNATURE_TEXT_LENGTH).trim(),
		matte: input?.matte === 'dark' ? 'dark' : 'light',
		motion: sanitizeBaked(input?.motion),
		script: {
			enabled: input?.script?.enabled === true,
			font: (SIGNATURE_SCRIPT_FONTS as readonly string[]).includes(input?.script?.font ?? '')
				? (input!.script!.font as SignatureScriptFont)
				: 'vibes',
			loop: input?.script?.loop === true
		},
		scriptImage: sanitizeBaked(input?.scriptImage),
		live: sanitizeLive(input?.live),
		liveImages: {
			available: sanitizeBaked(input?.liveImages?.available),
			away: sanitizeBaked(input?.liveImages?.away),
			ooo: sanitizeBaked(input?.liveImages?.ooo)
		}
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
export function serializeSignatureConfig(config: Partial<SignatureConfig>): string {
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

/** Keyframe bodies per preset. `ACCENT` is swapped for the sanitized accent hex. */
const ANIMATION_KEYFRAMES: Record<Exclude<SignatureAnimation, 'none'>, string> = {
	halo: 'to{transform:rotate(360deg)}',
	ripple: '0%,100%{transform:scale(1)}50%{transform:scale(1.05)}',
	shine: '0%,100%{filter:brightness(1)}50%{filter:brightness(1.12)}',
	float: '0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}',
	pulse: '0%,100%{transform:scale(1)}50%{transform:scale(1.08)}',
	spin: 'to{transform:rotate(360deg)}',
	wave: '0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}',
	glow: '0%,100%{filter:drop-shadow(0 0 0 rgba(0,0,0,0))}50%{filter:drop-shadow(0 0 6px ACCENT)}'
};

/** Timing/easing per preset, appended after the shared `NAME` animation name. */
const ANIMATION_TIMING: Record<Exclude<SignatureAnimation, 'none'>, string> = {
	halo: '8s linear infinite;transform-origin:center',
	ripple: '2.4s ease-in-out infinite',
	shine: '3s ease-in-out infinite',
	float: '3s ease-in-out infinite',
	pulse: '2.4s ease-in-out infinite',
	spin: '6s linear infinite;transform-origin:center',
	wave: '2.6s ease-in-out infinite;transform-origin:center',
	glow: '2.8s ease-in-out infinite'
};

/**
 * Motion for a signature image. Inputs are trusted: `animation` is a fixed enum,
 * `assetId` is a validated UUID, and `accent` is a validated hex colour — so the
 * emitted CSS carries no user-controlled strings. A `prefers-reduced-motion`
 * guard keeps it still for readers who ask for that. Returns an empty style and
 * class for `none` so imageless/static signatures are byte-for-byte unchanged.
 */
function buildImageAnimation(
	animation: SignatureAnimation,
	assetId: string,
	accent: string
): { style: string; className: string } {
	if (animation === 'none') return { style: '', className: '' };
	const className = `qm-sig-${animation}-${assetId.slice(0, 8)}`;
	const keyframesName = `${className}-kf`;
	const keyframes = ANIMATION_KEYFRAMES[animation].replaceAll('ACCENT', accent);
	const timing = ANIMATION_TIMING[animation];
	const style =
		`<style>@keyframes ${keyframesName}{${keyframes}}` +
		`.${className}{animation:${keyframesName} ${timing};will-change:transform}` +
		`@media (prefers-reduced-motion:reduce){.${className}{animation:none}}</style>`;
	return { style, className };
}

export type CompileOptions = {
	/** Where each asset is served from; the editor maps unsaved renders to local blob URLs. */
	assetUrl?: (assetId: string) => string;
	/** Show the live badge for `now` directly instead of linking the server endpoint. */
	preview?: boolean;
	now?: Date;
};

function bakedImg(image: BakedImage, url: string, alt: string): string {
	return `<img src="${escapeSignatureHtml(url)}" width="${image.w}" height="${image.h}" alt="${escapeSignatureHtml(alt)}" style="display:block;border:0;width:${image.w}px;height:${image.h}px;">`;
}

/** The rendered name, the typed details, then the live badge. */
function detailsBlock(config: SignatureConfig, resolve: (id: string) => string, origin: string, options: CompileOptions): string {
	const parts: string[] = [];
	if (config.script.enabled && config.scriptImage) {
		parts.push(`<div style="padding-bottom:4px;">${bakedImg(config.scriptImage, resolve(config.scriptImage.id), config.name || 'Signature')}</div>`);
	}
	parts.push(detailsHtml(config));
	const live = liveBadge(config, resolve, origin, options);
	if (live) parts.push(`<div style="padding-top:8px;">${live}</div>`);
	return parts.join('');
}

function liveBadge(config: SignatureConfig, resolve: (id: string) => string, origin: string, options: CompileOptions): string {
	const { live, liveImages } = config;
	if (!live.enabled || !liveImages.available || !liveImages.away) return '';
	const hasOoo = Boolean(liveImages.ooo && live.oooFrom && live.oooTo);
	if (options.preview) {
		const state = pickLiveState(options.now ?? new Date(), live, hasOoo);
		const image = (state === 'ooo' ? liveImages.ooo : liveImages[state]) ?? liveImages.away;
		return bakedImg(image, resolve(image.id), 'Availability');
	}
	if (!origin) return '';
	const path = liveStatusPath(
		{ available: liveImages.available.id, away: liveImages.away.id, ooo: hasOoo ? liveImages.ooo!.id : null },
		live
	);
	// Every state is rendered at the same size, so the layout never shifts between opens.
	return bakedImg(liveImages.available, `${origin.replace(/\/$/, '')}${path}`, 'Availability');
}

export function compileSignature(
	config: Partial<SignatureConfig>,
	origin = '',
	options: CompileOptions = {}
): { html: string; text: string } {
	const sanitized = sanitizeSignatureConfig(config);
	if (isSignatureEmpty(sanitized)) return { html: '', text: '' };

	if (sanitized.layout === 'plain') {
		const text = sanitized.text;
		return { html: escapeSignatureHtml(text).replaceAll('\n', '<br>\n'), text };
	}

	const resolve = options.assetUrl ?? ((id: string) => (origin ? signatureAssetUrl(origin, id) : ''));
	const details = detailsBlock(sanitized, resolve, origin, options);
	const text = detailsText(sanitized);

	const photoUrl =
		sanitized.layout === 'photo' && sanitized.photoId ? resolve(sanitized.photoId) : '';
	const logoUrl =
		sanitized.layout === 'logo' && sanitized.logoId ? resolve(sanitized.logoId) : '';
	// A baked animation replaces the still image; CSS motion is only a fallback for older signatures.
	const motion = sanitized.animation !== 'none' ? sanitized.motion : null;

	// A photo/logo can stand on its own — an animated mark is a valid sign-off
	// with no words. Only bail when there is neither an image nor any detail.
	if (!details && !photoUrl && !logoUrl) return { html: '', text: '' };

	if (photoUrl) {
		const detailsCell = details ? `<td valign="top">${details}</td>` : '';
		const pad = details ? 'padding-right:14px;' : '';
		if (motion) {
			return { html: wrapTable(`<tr><td valign="top" style="${pad}">${bakedImg(motion, resolve(motion.id), '')}</td>${detailsCell}</tr>`), text };
		}
		const css = buildImageAnimation(sanitized.animation, sanitized.photoId as string, sanitized.accent);
		const classAttr = css.className ? ` class="${css.className}"` : '';
		const html =
			css.style +
			wrapTable(
				`<tr><td valign="top" style="${pad}"><img${classAttr} src="${escapeSignatureHtml(photoUrl)}" width="72" height="72" alt="" style="display:block;border:0;width:72px;height:72px;object-fit:cover;"></td>${detailsCell}</tr>`
			);
		return { html, text };
	}

	if (logoUrl) {
		const detailsRow = details ? `<tr><td>${details}</td></tr>` : '';
		const pad = details ? 'padding-bottom:10px;' : '';
		if (motion) {
			return { html: wrapTable(`<tr><td style="${pad}">${bakedImg(motion, resolve(motion.id), '')}</td></tr>${detailsRow}`), text };
		}
		const css = buildImageAnimation(sanitized.animation, sanitized.logoId as string, sanitized.accent);
		const classAttr = css.className ? ` class="${css.className}"` : '';
		const html =
			css.style +
			wrapTable(
				`<tr><td style="${pad}"><img${classAttr} src="${escapeSignatureHtml(logoUrl)}" alt="" height="36" style="display:block;border:0;max-height:36px;height:36px;width:auto;"></td></tr>${detailsRow}`
			);
		return { html, text };
	}

	return { html: wrapTable(`<tr><td>${details}</td></tr>`), text };
}
