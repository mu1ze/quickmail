/**
 * Renders signature effects in the browser and encodes them as animated GIFs.
 *
 * Email clients strip CSS animation (Gmail, Outlook) but play GIFs, so every
 * effect is drawn frame by frame on a canvas at 2x and baked into an image.
 * GIF transparency is 1-bit, so frames are painted over a solid "matte" that
 * matches the reader's light or dark email background.
 */
import type { Palette } from 'gifenc';
import { formatLiveTime, formatReturnDate, zoneLabel } from './signature-live';
import type { SignatureAnimation, SignatureLive, SignatureMatte, SignatureScriptFont } from './signature-template';

const SCALE = 2;
const TRANSPARENT = 255;

export const MATTE_COLORS: Record<SignatureMatte, string> = { light: '#ffffff', dark: '#1f1f1f' };

export type Rendered = { blob: Blob; w: number; h: number };

type DrawFrame = (ctx: CanvasRenderingContext2D, t: number) => void;

type GifPlan = {
	w: number;
	h: number;
	frames: number;
	/** Delay per frame in ms, or a function of the frame index. */
	delay: number | ((frame: number) => number);
	/** 0 loops forever, -1 plays once. */
	repeat: number;
	matte: string;
	draw: DrawFrame;
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
	const el = document.createElement('canvas');
	el.width = Math.round(w * SCALE);
	el.height = Math.round(h * SCALE);
	const ctx = el.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('Canvas is not available in this browser');
	return [el, ctx];
}

/**
 * Draws every frame, builds one shared palette, and writes each later frame as
 * only the pixels that changed (the rest transparent, kept from the previous
 * frame). Static subjects like a photo inside a spinning ring cost almost nothing.
 */
type GifLib = typeof import('gifenc');
let gifLib: Promise<GifLib> | null = null;

/** The encoder is CommonJS and only needed in the browser, so it loads on first render. */
function loadGifLib(): Promise<GifLib> {
	gifLib ??= import('gifenc').then((mod) => ((mod as unknown as { default?: GifLib }).default ?? mod) as GifLib);
	return gifLib;
}

async function encodeGif(plan: GifPlan): Promise<Rendered> {
	const { GIFEncoder, applyPalette, quantize } = await loadGifLib();
	const [el, ctx] = canvas(plan.w, plan.h);
	const W = el.width;
	const H = el.height;
	const frames: Uint8ClampedArray[] = [];
	for (let i = 0; i < plan.frames; i++) {
		ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
		ctx.fillStyle = plan.matte;
		ctx.fillRect(0, 0, plan.w, plan.h);
		plan.draw(ctx, plan.frames === 1 ? 1 : i / plan.frames);
		frames.push(ctx.getImageData(0, 0, W, H).data);
	}

	// One palette from a spread of frames keeps colours stable, so unchanged pixels match exactly.
	const picks = [0, Math.floor(frames.length / 3), Math.floor((2 * frames.length) / 3), frames.length - 1];
	const sample = new Uint8ClampedArray(picks.length * frames[0].length);
	picks.forEach((pick, n) => sample.set(frames[pick], n * frames[0].length));
	const palette: Palette = quantize(sample, 255);
	while (palette.length < 256) palette.push([0, 0, 0]);

	const gif = GIFEncoder();
	let previous: Uint8Array | null = null;
	frames.forEach((data, i) => {
		const index = applyPalette(data, palette.slice(0, 255));
		const delay = typeof plan.delay === 'function' ? plan.delay(i) : plan.delay;
		if (!previous) {
			gif.writeFrame(index, W, H, { palette, delay, repeat: plan.repeat });
		} else {
			const delta = new Uint8Array(index.length);
			for (let p = 0; p < index.length; p++) delta[p] = index[p] === previous[p] ? TRANSPARENT : index[p];
			gif.writeFrame(delta, W, H, { delay, transparent: true, transparentIndex: TRANSPARENT, dispose: 1 });
		}
		previous = index;
	});
	gif.finish();
	return { blob: new Blob([gif.bytes() as BlobPart], { type: 'image/gif' }), w: plan.w, h: plan.h };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.decoding = 'async';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not load the image'));
		img.src = url;
	});
}

function hexToRgb(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number): string {
	const [r, g, b] = hexToRgb(hex);
	return `rgba(${r},${g},${b},${alpha})`;
}

/** Draws `img` cover-fitted into a circle of radius r at (cx, cy). */
function drawRound(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, r: number) {
	ctx.save();
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.clip();
	const side = Math.min(img.naturalWidth, img.naturalHeight);
	const sx = (img.naturalWidth - side) / 2;
	const sy = (img.naturalHeight - side) / 2;
	ctx.drawImage(img, sx, sy, side, side, cx - r, cy - r, r * 2, r * 2);
	ctx.restore();
}

const wave = (t: number) => Math.sin(t * Math.PI * 2);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Frame count and timing per effect: smooth loops without bloating the file. */
const MOTION_TIMING: Record<Exclude<SignatureAnimation, 'none'>, { frames: number; delay: number }> = {
	halo: { frames: 30, delay: 60 },
	ripple: { frames: 28, delay: 60 },
	float: { frames: 28, delay: 70 },
	shine: { frames: 32, delay: 70 },
	glow: { frames: 26, delay: 80 },
	pulse: { frames: 24, delay: 70 },
	wave: { frames: 24, delay: 70 },
	spin: { frames: 36, delay: 60 }
};

/** Box the round photo is drawn in, with room for rings and glow around it. */
export const PHOTO_BOX = 88;
const PHOTO_R = 34;

/** Bakes the round headshot with its effect. */
export async function renderPhotoMotion(
	url: string,
	effect: Exclude<SignatureAnimation, 'none'>,
	accent: string,
	matte: SignatureMatte
): Promise<Rendered> {
	const img = await loadImage(url);
	const c = PHOTO_BOX / 2;
	const r = PHOTO_R;
	const bg = MATTE_COLORS[matte];
	const draw: DrawFrame = (ctx, t) => {
		switch (effect) {
			case 'halo': {
				// A comet of accent colour sweeping around the photo.
				const ring = ctx.createConicGradient(t * Math.PI * 2, c, c);
				ring.addColorStop(0, rgba(accent, 1));
				ring.addColorStop(0.35, rgba(accent, 0.35));
				ring.addColorStop(0.7, rgba(accent, 0));
				ring.addColorStop(1, rgba(accent, 1));
				ctx.beginPath();
				ctx.arc(c, c, r + 5, 0, Math.PI * 2);
				ctx.lineWidth = 3.5;
				ctx.strokeStyle = ring;
				ctx.stroke();
				drawRound(ctx, img, c, c, r);
				break;
			}
			case 'ripple': {
				for (const offset of [0, 0.5]) {
					const p = (t + offset) % 1;
					ctx.beginPath();
					ctx.arc(c, c, r + 1 + p * 9, 0, Math.PI * 2);
					ctx.lineWidth = 2.2 * (1 - p) + 0.4;
					ctx.strokeStyle = rgba(accent, 0.75 * (1 - p));
					ctx.stroke();
				}
				drawRound(ctx, img, c, c, r);
				break;
			}
			case 'float': {
				const dy = -3.5 * wave(t);
				const lift = (dy + 3.5) / 7;
				ctx.beginPath();
				ctx.ellipse(c, c + r + 5, r * (0.7 - 0.12 * lift), 2.4, 0, 0, Math.PI * 2);
				ctx.fillStyle = matte === 'dark' ? `rgba(0,0,0,${0.55 - 0.25 * lift})` : `rgba(0,0,0,${0.16 - 0.07 * lift})`;
				ctx.fill();
				drawRound(ctx, img, c, c - 2 + dy, r);
				break;
			}
			case 'shine': {
				drawRound(ctx, img, c, c, r);
				// A glossy sweep in the first part of each loop, then a pause.
				const p = t / 0.45;
				if (p <= 1) {
					ctx.save();
					ctx.beginPath();
					ctx.arc(c, c, r, 0, Math.PI * 2);
					ctx.clip();
					const x = c - r * 2.2 + p * r * 4.4;
					const band = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
					band.addColorStop(0, 'rgba(255,255,255,0)');
					band.addColorStop(0.5, 'rgba(255,255,255,0.55)');
					band.addColorStop(1, 'rgba(255,255,255,0)');
					ctx.translate(c, c);
					ctx.rotate(-0.45);
					ctx.translate(-c, -c);
					ctx.fillStyle = band;
					ctx.fillRect(0, -PHOTO_BOX, PHOTO_BOX * 2, PHOTO_BOX * 3);
					ctx.restore();
				}
				ctx.beginPath();
				ctx.arc(c, c, r + 2.5, 0, Math.PI * 2);
				ctx.lineWidth = 1.5;
				ctx.strokeStyle = rgba(accent, 0.6);
				ctx.stroke();
				break;
			}
			case 'glow': {
				const strength = 0.25 + 0.3 * (0.5 + 0.5 * wave(t));
				const halo = ctx.createRadialGradient(c, c, r - 2, c, c, r + 10);
				halo.addColorStop(0, rgba(accent, strength));
				halo.addColorStop(1, rgba(accent, 0));
				ctx.fillStyle = halo;
				ctx.fillRect(0, 0, PHOTO_BOX, PHOTO_BOX);
				drawRound(ctx, img, c, c, r);
				break;
			}
			case 'pulse': {
				const s = 1 + 0.05 * (0.5 + 0.5 * wave(t));
				drawRound(ctx, img, c, c, r * s);
				break;
			}
			case 'wave': {
				ctx.save();
				ctx.translate(c, c + r * 0.6);
				ctx.rotate((8 * Math.PI) / 180 * wave(t));
				ctx.translate(-c, -(c + r * 0.6));
				drawRound(ctx, img, c, c, r);
				ctx.restore();
				break;
			}
			case 'spin': {
				ctx.save();
				ctx.translate(c, c);
				ctx.rotate(t * Math.PI * 2);
				ctx.translate(-c, -c);
				drawRound(ctx, img, c, c, r);
				ctx.restore();
				break;
			}
		}
	};
	const timing = MOTION_TIMING[effect];
	return encodeGif({ w: PHOTO_BOX, h: PHOTO_BOX, frames: timing.frames, delay: timing.delay, repeat: 0, matte: bg, draw });
}

/** Bakes the logo mark (36px tall) with an effect suited to a non-round image. */
export async function renderLogoMotion(
	url: string,
	effect: Exclude<SignatureAnimation, 'none'>,
	accent: string,
	matte: SignatureMatte
): Promise<Rendered> {
	const img = await loadImage(url);
	const lh = 36;
	const lw = Math.min(220, Math.round((img.naturalWidth / img.naturalHeight) * lh));
	const pad = 6;
	const w = lw + pad * 2;
	const h = lh + pad * 2;
	const draw: DrawFrame = (ctx, t) => {
		const x = pad;
		const y = pad;
		ctx.save();
		if (effect === 'float') ctx.translate(0, -2.5 * wave(t));
		if (effect === 'pulse' || effect === 'ripple') {
			const s = 1 + 0.05 * (0.5 + 0.5 * wave(t));
			ctx.translate(w / 2, h / 2);
			ctx.scale(s, s);
			ctx.translate(-w / 2, -h / 2);
		}
		if (effect === 'wave' || effect === 'spin') {
			ctx.translate(w / 2, h / 2);
			ctx.rotate((6 * Math.PI) / 180 * wave(t));
			ctx.translate(-w / 2, -h / 2);
		}
		if (effect === 'glow' || effect === 'halo') {
			ctx.shadowColor = rgba(accent, 0.25 + 0.35 * (0.5 + 0.5 * wave(t)));
			ctx.shadowBlur = 8;
		}
		ctx.drawImage(img, x, y, lw, lh);
		ctx.restore();
		if (effect === 'shine' && t < 0.45) {
			const p = t / 0.45;
			const bx = -20 + p * (w + 40);
			const band = ctx.createLinearGradient(bx - 12, 0, bx + 12, 0);
			band.addColorStop(0, 'rgba(255,255,255,0)');
			band.addColorStop(0.5, 'rgba(255,255,255,0.5)');
			band.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.save();
			ctx.globalCompositeOperation = 'source-atop';
			ctx.fillStyle = band;
			ctx.fillRect(0, 0, w, h);
			ctx.restore();
		}
	};
	const timing = MOTION_TIMING[effect];
	return encodeGif({ w, h, frames: timing.frames, delay: timing.delay, repeat: 0, matte: MATTE_COLORS[matte], draw });
}

export const SCRIPT_FONTS: Record<SignatureScriptFont, { label: string; family: string; weight: number; size: number }> = {
	vibes: { label: 'Great Vibes', family: 'Great Vibes', weight: 400, size: 40 },
	allura: { label: 'Allura', family: 'Allura', weight: 400, size: 40 },
	caveat: { label: 'Caveat', family: 'Caveat', weight: 600, size: 34 },
	apple: { label: 'Homemade Apple', family: 'Homemade Apple', weight: 400, size: 24 }
};

let fontsRequested = false;

/** Loads the script fonts (and Inter for badges) so the canvas can draw with them. */
export async function loadSignatureFonts(): Promise<void> {
	if (!fontsRequested) {
		fontsRequested = true;
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href =
			'https://fonts.googleapis.com/css2?family=Allura&family=Caveat:wght@600&family=Great+Vibes&family=Homemade+Apple&family=Inter:wght@500;600&display=swap';
		document.head.appendChild(link);
		await new Promise((resolve) => {
			link.onload = resolve;
			link.onerror = resolve;
		});
	}
	await Promise.all(
		[...Object.values(SCRIPT_FONTS).map((font) => `${font.weight} ${font.size}px "${font.family}"`), '600 12px Inter'].map((spec) =>
			document.fonts.load(spec).catch(() => [])
		)
	);
}

/** The name written out left to right with a pen nib following the ink, then underlined. */
export async function renderHandwrittenName(
	name: string,
	fontId: SignatureScriptFont,
	accent: string,
	matte: SignatureMatte,
	loop: boolean
): Promise<Rendered> {
	await loadSignatureFonts();
	const font = SCRIPT_FONTS[fontId];
	let size = font.size;
	const measureCtx = canvas(1, 1)[1];
	const spec = (px: number) => `${font.weight} ${px}px "${font.family}"`;
	measureCtx.setTransform(1, 0, 0, 1, 0, 0);
	measureCtx.font = spec(size);
	let metrics = measureCtx.measureText(name);
	const maxInk = 420;
	const inkWidth = () => metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
	if (inkWidth() > maxInk) {
		size = Math.max(16, Math.floor((size * maxInk) / inkWidth()));
		measureCtx.font = spec(size);
		metrics = measureCtx.measureText(name);
	}
	const padX = 10;
	const ascent = metrics.actualBoundingBoxAscent;
	const descent = metrics.actualBoundingBoxDescent;
	const w = Math.ceil(inkWidth() + padX * 2);
	const underlineGap = 7;
	const h = Math.ceil(ascent + descent + 8 + underlineGap);
	const baseline = 4 + ascent;
	const left = padX + metrics.actualBoundingBoxLeft;

	// The finished lettering, drawn once; each frame reveals more of it.
	const [ink, inkCtx] = canvas(w, h);
	inkCtx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
	inkCtx.font = spec(size);
	inkCtx.fillStyle = accent;
	inkCtx.fillText(name, left, baseline);

	// Where the ink sits in each column, so the nib rides along the letters.
	const pixels = inkCtx.getImageData(0, 0, ink.width, ink.height).data;
	const inkY: number[] = [];
	let lastY = baseline - ascent / 3;
	for (let x = 0; x < ink.width; x++) {
		let sum = 0;
		let count = 0;
		for (let y = 0; y < ink.height; y++) {
			if (pixels[(y * ink.width + x) * 4 + 3] > 140) {
				sum += y;
				count++;
			}
		}
		lastY = count ? sum / count / SCALE : lastY;
		inkY.push(lastY);
	}

	const inkLeft = padX - 2;
	const inkRight = w - padX + 2;
	const writeFrames = Math.min(48, Math.max(24, Math.round(name.length * 2.6)));
	const underlineFrames = 10;
	const total = writeFrames + underlineFrames + 1;
	const [mask, maskCtx] = canvas(w, h);
	const underlineY = h - underlineGap / 2 - 2;

	const draw: DrawFrame = (ctx, t) => {
		const frame = Math.round(t * total);
		const writing = Math.min(1, frame / writeFrames);
		const x = inkLeft + easeInOut(writing) * (inkRight - inkLeft);
		// Reveal the lettering up to the nib with a short soft edge.
		maskCtx.setTransform(1, 0, 0, 1, 0, 0);
		maskCtx.globalCompositeOperation = 'source-over';
		maskCtx.clearRect(0, 0, mask.width, mask.height);
		maskCtx.drawImage(ink, 0, 0);
		maskCtx.globalCompositeOperation = 'destination-in';
		const edge = maskCtx.createLinearGradient((x - 6) * SCALE, 0, x * SCALE, 0);
		edge.addColorStop(0, 'rgba(0,0,0,1)');
		edge.addColorStop(1, 'rgba(0,0,0,0)');
		maskCtx.fillStyle = edge;
		maskCtx.fillRect(0, 0, x * SCALE, mask.height);
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.drawImage(mask, 0, 0);
		ctx.restore();

		if (writing < 1) {
			const y = inkY[Math.max(0, Math.min(inkY.length - 1, Math.round(x * SCALE)))];
			ctx.beginPath();
			ctx.arc(x, y, 2, 0, Math.PI * 2);
			ctx.fillStyle = accent;
			ctx.fill();
		}

		const flourish = Math.max(0, Math.min(1, (frame - writeFrames) / underlineFrames));
		if (flourish > 0) {
			const x0 = padX + 4;
			const x1 = padX + 4 + (w - padX * 2 - 8) * easeInOut(flourish);
			ctx.beginPath();
			ctx.moveTo(x0, underlineY + 1.5);
			ctx.quadraticCurveTo((x0 + x1) / 2, underlineY - 2.5, x1, underlineY);
			ctx.lineWidth = 1.4;
			ctx.lineCap = 'round';
			ctx.strokeStyle = rgba(accent, 0.7);
			ctx.stroke();
		}
	};

	return encodeGif({
		w,
		h,
		frames: total,
		// Linger on the finished signature before a loop starts over.
		delay: (frame) => (frame === total - 1 ? (loop ? 3200 : 100) : frame < writeFrames ? 45 : 35),
		repeat: loop ? 0 : -1,
		matte: MATTE_COLORS[matte],
		draw
	});
}

const BADGE_TONES: Record<SignatureMatte, Record<'available' | 'away' | 'ooo', { bg: string; fg: string; dot: string }>> = {
	light: {
		available: { bg: '#e9f7ef', fg: '#17663a', dot: '#22c55e' },
		away: { bg: '#f1f3f5', fg: '#4f5b66', dot: '#9aa6b3' },
		ooo: { bg: '#fff1e6', fg: '#9a3412', dot: '#f59e0b' }
	},
	dark: {
		available: { bg: '#15291e', fg: '#86efac', dot: '#22c55e' },
		away: { bg: '#262c34', fg: '#b7c1cc', dot: '#7c8794' },
		ooo: { bg: '#2d1f12', fg: '#fdba74', dot: '#f59e0b' }
	}
};

export function liveBadgeLabels(live: SignatureLive): { available: string; away: string; ooo: string } {
	const zone = zoneLabel(live.tz);
	const where = live.city.trim() ? ` · ${live.city.trim()}` : '';
	return {
		available: `Available now${where}`,
		away: `Away · back ${formatLiveTime(live.start)} ${zone}`,
		ooo: live.oooTo ? `Out of office · back ${formatReturnDate(live.oooTo)}` : 'Out of office'
	};
}

/** The three availability pills, all the same size so the layout never shifts. */
export async function renderLiveBadges(
	live: SignatureLive,
	matte: SignatureMatte
): Promise<{ available: Rendered; away: Rendered; ooo: Rendered }> {
	await loadSignatureFonts();
	const labels = liveBadgeLabels(live);
	const ctx = canvas(1, 1)[1];
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.font = '600 12px Inter, Arial, sans-serif';
	const text = Math.max(...Object.values(labels).map((label) => ctx.measureText(label).width));
	const h = 24;
	const w = Math.ceil(text + 10 + 8 + 8 + 12);
	const tones = BADGE_TONES[matte];

	const pill = (state: 'available' | 'away' | 'ooo', t: number, c: CanvasRenderingContext2D) => {
		const tone = tones[state];
		c.beginPath();
		c.roundRect(0.5, 0.5, w - 1, h - 1, h / 2);
		c.fillStyle = tone.bg;
		c.fill();
		const dx = 12;
		const dy = h / 2;
		if (state === 'available') {
			// A soft ping around the dot, like a live indicator.
			c.beginPath();
			c.arc(dx, dy, 3.5 + 4 * t, 0, Math.PI * 2);
			c.fillStyle = rgba(tone.dot, 0.45 * (1 - t));
			c.fill();
		}
		c.beginPath();
		c.arc(dx, dy, 3.5, 0, Math.PI * 2);
		c.fillStyle = tone.dot;
		c.fill();
		c.font = '600 12px Inter, Arial, sans-serif';
		c.fillStyle = tone.fg;
		c.textBaseline = 'middle';
		c.fillText(labels[state], dx + 9, dy + 0.5);
	};

	const matteColor = MATTE_COLORS[matte];
	const [available, away, ooo] = await Promise.all([
		encodeGif({ w, h, frames: 18, delay: 80, repeat: 0, matte: matteColor, draw: (c, t) => pill('available', t, c) }),
		encodeGif({ w, h, frames: 1, delay: 0, repeat: 0, matte: matteColor, draw: (c) => pill('away', 0, c) }),
		encodeGif({ w, h, frames: 1, delay: 0, repeat: 0, matte: matteColor, draw: (c) => pill('ooo', 0, c) })
	]);
	return { available, away, ooo };
}
