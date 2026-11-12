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

type MotionTiming = { frames: number; delay: number | ((frame: number) => number) };

/** Rests on the untouched first frame, then plays the rest at an even step. */
const held = (hold: number, step: number) => (frame: number) => (frame === 0 ? hold : step);

/**
 * How hard each glitch frame is hit (0 is the clean image) and how long it shows.
 * Short bursts between long rests read as interference rather than constant noise.
 */
const GLITCH_FRAMES: readonly (readonly [strength: number, delay: number])[] = [
	[0, 1500], [1, 60], [0.6, 60], [1, 60], [0.4, 60], [0, 140], [0.8, 60], [0.5, 60],
	[0, 1900], [0.5, 60], [1, 60], [0.7, 60], [0, 90], [1, 70], [0.5, 70], [0, 700]
];

/**
 * Frame count and timing per effect: smooth loops without bloating the file.
 * Effects that take the image apart always open on the intact image, because
 * clients that do not animate GIFs (desktop Outlook) show only the first frame.
 */
export const MOTION_TIMING: Record<Exclude<SignatureAnimation, 'none'>, MotionTiming> = {
	halo: { frames: 30, delay: 60 },
	ripple: { frames: 28, delay: 60 },
	float: { frames: 28, delay: 70 },
	shine: { frames: 32, delay: 70 },
	glow: { frames: 26, delay: 80 },
	pulse: { frames: 24, delay: 70 },
	wave: { frames: 24, delay: 70 },
	spin: { frames: 36, delay: 60 },
	shatter: { frames: 34, delay: held(1400, 50) },
	dust: { frames: 36, delay: held(1400, 55) },
	glitch: { frames: GLITCH_FRAMES.length, delay: (frame) => GLITCH_FRAMES[frame][1] },
	orbit: { frames: 32, delay: 60 },
	flip: { frames: 26, delay: held(1800, 45) }
};

/** The finished image on a transparent canvas, for effects that cut it up or move it whole. */
type Still = { el: HTMLCanvasElement; w: number; h: number };

function makeStill(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Still {
	const [el, ctx] = canvas(w, h);
	ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
	paint(ctx);
	return { el, w, h };
}

function drawStill(ctx: CanvasRenderingContext2D, still: Still, dx = 0, dy = 0) {
	ctx.drawImage(still.el, dx, dy, still.w, still.h);
}

/** Small seeded generator, so a signature renders the same fragments every time. */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let n = Math.imul(a ^ (a >>> 15), 1 | a);
		n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
		return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
	};
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export type Shard = {
	points: [number, number][];
	cx: number;
	cy: number;
	/** Where the shard ends up, relative to its resting place. */
	dx: number;
	dy: number;
	spin: number;
	/** 0..1: how late the shard leaves (and how early it returns). */
	lag: number;
};

/**
 * Cuts a w x h box into irregular triangles that tile it exactly: a jittered
 * grid (edge points stay on the edge) with each cell split along a random diagonal.
 */
export function buildShards(w: number, h: number, cell: number, travel: number, seed = 7): Shard[] {
	const random = seededRandom(seed);
	const cols = Math.max(2, Math.round(w / cell));
	const rows = Math.max(2, Math.round(h / cell));
	const cw = w / cols;
	const ch = h / rows;
	const grid: [number, number][][] = [];
	for (let row = 0; row <= rows; row++) {
		const line: [number, number][] = [];
		for (let col = 0; col <= cols; col++) {
			const jx = col === 0 || col === cols ? 0 : (random() - 0.5) * 0.7 * cw;
			const jy = row === 0 || row === rows ? 0 : (random() - 0.5) * 0.7 * ch;
			line.push([col * cw + jx, row * ch + jy]);
		}
		grid.push(line);
	}
	const reach = Math.hypot(w / 2, h / 2);
	const shards: Shard[] = [];
	const add = (points: [number, number][]) => {
		const cx = (points[0][0] + points[1][0] + points[2][0]) / 3;
		const cy = (points[0][1] + points[1][1] + points[2][1]) / 3;
		// Fly away from the centre, with enough scatter that it does not look like a zoom.
		const angle = Math.atan2(cy - h / 2, cx - w / 2) + (random() - 0.5) * 1.1;
		const far = Math.hypot(cx - w / 2, cy - h / 2) / reach;
		const distance = travel * (0.55 + 0.45 * random()) * (0.6 + 0.4 * far);
		shards.push({
			points,
			cx,
			cy,
			dx: Math.cos(angle) * distance,
			dy: Math.sin(angle) * distance,
			spin: (random() - 0.5) * 1.6,
			lag: clamp01(0.55 * (1 - far) + 0.25 * random())
		});
	};
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const a = grid[row][col];
			const b = grid[row][col + 1];
			const c = grid[row + 1][col + 1];
			const d = grid[row + 1][col];
			if (random() < 0.5) {
				add([a, b, c]);
				add([a, c, d]);
			} else {
				add([a, b, d]);
				add([b, c, d]);
			}
		}
	}
	return shards;
}

/** How far apart the image is at loop position t: 0 intact, 1 fully scattered. */
export function shatterProgress(t: number): number {
	const out = 0.42;
	return t < out ? easeOut(t / out) : 1 - easeInOut((t - out) / (1 - out));
}

/** The image bursts into shards that drift off and fade, then fly back together. */
function drawShatter(ctx: CanvasRenderingContext2D, still: Still, shards: Shard[], t: number, ox = 0, oy = 0) {
	const p = shatterProgress(t);
	if (p < 0.004) {
		drawStill(ctx, still, ox, oy);
		return;
	}
	for (const shard of shards) {
		const q = clamp01(p * (1 + shard.lag) - shard.lag);
		ctx.save();
		ctx.translate(ox, oy);
		ctx.globalAlpha = 1 - 0.92 * q * q;
		ctx.translate(shard.cx + shard.dx * q, shard.cy + shard.dy * q);
		ctx.rotate(shard.spin * q);
		const s = 1 - 0.25 * q;
		ctx.scale(s, s);
		ctx.translate(-shard.cx, -shard.cy);
		ctx.beginPath();
		shard.points.forEach(([x, y], n) => {
			// Grown a hair past its true edge so resting neighbours leave no seam.
			const gx = x + Math.sign(x - shard.cx) * 0.35;
			const gy = y + Math.sign(y - shard.cy) * 0.35;
			if (n === 0) ctx.moveTo(gx, gy);
			else ctx.lineTo(gx, gy);
		});
		ctx.closePath();
		ctx.clip();
		drawStill(ctx, still);
		ctx.restore();
	}
}

type Mote = { x: number; y: number; at: number; dx: number; dy: number };
const MOTE = 3;

/** The grains the image is made of, each with the moment the breeze reaches it. */
function buildMotes(still: Still): Mote[] {
	const ctx = still.el.getContext('2d', { willReadFrequently: true });
	if (!ctx) return [];
	const data = ctx.getImageData(0, 0, still.el.width, still.el.height).data;
	const random = seededRandom(11);
	const motes: Mote[] = [];
	for (let y = 0; y < still.h; y += MOTE) {
		for (let x = 0; x < still.w; x += MOTE) {
			const px = Math.min(still.el.width - 1, Math.round((x + MOTE / 2) * SCALE));
			const py = Math.min(still.el.height - 1, Math.round((y + MOTE / 2) * SCALE));
			const drift = random();
			const jitter = random();
			if (data[(py * still.el.width + px) * 4 + 3] < 24) continue;
			motes.push({
				x,
				y,
				// Sweeps from the right edge inward, raggedly.
				at: 0.62 * (1 - x / still.w) + 0.2 * jitter,
				dx: 5 + 9 * drift,
				dy: -(2 + 9 * jitter)
			});
		}
	}
	return motes;
}

/** The image blows away as dust from one side, then settles back. */
function drawDust(ctx: CanvasRenderingContext2D, still: Still, motes: Mote[], t: number, ox = 0, oy = 0) {
	const p = t < 0.5 ? t / 0.5 : 1 - easeInOut((t - 0.5) / 0.5);
	if (p < 0.004) {
		drawStill(ctx, still, ox, oy);
		return;
	}
	for (const mote of motes) {
		const q = clamp01((p - mote.at) / 0.18);
		if (q >= 1) continue;
		const size = MOTE * (1 - 0.55 * q);
		ctx.globalAlpha = 1 - q;
		ctx.drawImage(
			still.el,
			mote.x * SCALE,
			mote.y * SCALE,
			MOTE * SCALE,
			MOTE * SCALE,
			ox + mote.x + mote.dx * easeOut(q),
			oy + mote.y + mote.dy * q * q,
			size,
			size
		);
	}
	ctx.globalAlpha = 1;
}

/** A flat-colour copy of the image, for the colour fringes of a glitch. */
function tintStill(still: Still, color: string): Still {
	return makeStill(still.w, still.h, (ctx) => {
		drawStill(ctx, still);
		ctx.globalCompositeOperation = 'source-in';
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, still.w, still.h);
	});
}

type GlitchKit = { still: Still; warm: Still; cool: Still; accent: string };

function makeGlitchKit(still: Still, accent: string): GlitchKit {
	return { still, warm: tintStill(still, '#ff2a6d'), cool: tintStill(still, '#05d9e8'), accent };
}

/** Bursts of torn scanlines and split colour, with the clean image in between. */
function drawGlitch(ctx: CanvasRenderingContext2D, kit: GlitchKit, t: number, ox = 0, oy = 0) {
	const { still } = kit;
	const frame = Math.round(t * GLITCH_FRAMES.length) % GLITCH_FRAMES.length;
	const strength = GLITCH_FRAMES[frame][0];
	if (strength === 0) {
		drawStill(ctx, still, ox, oy);
		return;
	}
	const random = seededRandom(frame * 7919 + 3);
	const split = 3 * strength;
	ctx.globalAlpha = 0.75;
	drawStill(ctx, kit.warm, ox - split, oy);
	drawStill(ctx, kit.cool, ox + split, oy);
	ctx.globalAlpha = 1;
	let y = 0;
	while (y < still.h) {
		const band = Math.min(still.h - y, 4 + Math.floor(random() * 14));
		const shift = random() < 0.45 ? Math.round((random() - 0.5) * 12 * strength) : 0;
		ctx.drawImage(still.el, 0, y * SCALE, still.el.width, band * SCALE, ox + shift, oy + y, still.w, band);
		y += band;
	}
	const barY = Math.floor(random() * (still.h - 3));
	const barX = random() * still.w * 0.5;
	ctx.fillStyle = rgba(kit.accent, 0.55);
	ctx.fillRect(ox + barX, oy + barY, still.w * (0.2 + 0.3 * random()), 1.5);
}

type Orbit = { cx: number; cy: number; rx: number; ry: number; tilt: number };

/** One half of a pair of satellites circling on a tilted ring: the far half, or the near half. */
function drawOrbit(ctx: CanvasRenderingContext2D, orbit: Orbit, accent: string, t: number, near: boolean) {
	ctx.save();
	ctx.translate(orbit.cx, orbit.cy);
	ctx.rotate(orbit.tilt);
	for (const offset of [0, 0.5]) {
		// A short fading tail behind each satellite.
		for (let tail = 5; tail >= 0; tail--) {
			const angle = (t + offset - tail * 0.016) * Math.PI * 2;
			const depth = Math.sin(angle);
			if (depth >= 0 !== near) continue;
			const fade = 1 - tail / 6;
			ctx.beginPath();
			ctx.arc(orbit.rx * Math.cos(angle), orbit.ry * depth, (2 + 0.9 * depth) * (0.45 + 0.55 * fade), 0, Math.PI * 2);
			ctx.fillStyle = rgba(accent, (0.5 + 0.25 * (depth + 1)) * fade * fade);
			ctx.fill();
		}
	}
	ctx.restore();
}

/** A coin flip about the vertical axis; both faces show the image the right way round. */
function drawFlip(ctx: CanvasRenderingContext2D, still: Still, t: number, ox = 0, oy = 0) {
	const turn = Math.cos(easeInOut(t) * Math.PI * 2);
	const sx = Math.max(0.03, Math.abs(turn));
	ctx.save();
	ctx.translate(ox + still.w / 2, 0);
	ctx.scale(sx, 1);
	ctx.translate(-still.w / 2, 0);
	drawStill(ctx, still, 0, oy);
	ctx.restore();
}

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
	const still = makeStill(PHOTO_BOX, PHOTO_BOX, (ctx) => drawRound(ctx, img, c, c, r));
	const shards = effect === 'shatter' ? buildShards(PHOTO_BOX, PHOTO_BOX, 13, 12) : [];
	const motes = effect === 'dust' ? buildMotes(still) : [];
	const glitch = effect === 'glitch' ? makeGlitchKit(still, accent) : null;
	const orbit: Orbit = { cx: c, cy: c, rx: r + 6, ry: 13, tilt: -0.32 };
	const draw: DrawFrame = (ctx, t) => {
		switch (effect) {
			case 'shatter':
				drawShatter(ctx, still, shards, t);
				break;
			case 'dust':
				drawDust(ctx, still, motes, t);
				break;
			case 'glitch':
				if (glitch) drawGlitch(ctx, glitch, t);
				break;
			case 'orbit':
				drawOrbit(ctx, orbit, accent, t, false);
				drawStill(ctx, still);
				drawOrbit(ctx, orbit, accent, t, true);
				break;
			case 'flip':
				drawFlip(ctx, still, t);
				break;
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
	const still = makeStill(lw, lh, (ctx) => ctx.drawImage(img, 0, 0, lw, lh));
	const shards = effect === 'shatter' ? buildShards(lw, lh, 12, 9) : [];
	const motes = effect === 'dust' ? buildMotes(still) : [];
	const glitch = effect === 'glitch' ? makeGlitchKit(still, accent) : null;
	const orbit: Orbit = { cx: w / 2, cy: h / 2, rx: w / 2 - 4, ry: 9, tilt: -0.08 };
	const draw: DrawFrame = (ctx, t) => {
		const x = pad;
		const y = pad;
		if (effect === 'shatter') return drawShatter(ctx, still, shards, t, x, y);
		if (effect === 'dust') return drawDust(ctx, still, motes, t, x, y);
		if (effect === 'glitch') return glitch ? drawGlitch(ctx, glitch, t, x, y) : undefined;
		if (effect === 'flip') return drawFlip(ctx, still, t, x, y);
		if (effect === 'orbit') {
			drawOrbit(ctx, orbit, accent, t, false);
			drawStill(ctx, still, x, y);
			drawOrbit(ctx, orbit, accent, t, true);
			return;
		}
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
