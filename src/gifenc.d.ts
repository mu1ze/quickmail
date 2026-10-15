declare module 'gifenc' {
	export type Palette = number[][];
	export type GifFrameOptions = {
		palette?: Palette;
		first?: boolean;
		transparent?: boolean;
		transparentIndex?: number;
		delay?: number;
		repeat?: number;
		dispose?: number;
	};
	export type GifStream = {
		writeFrame(index: Uint8Array, width: number, height: number, options?: GifFrameOptions): void;
		finish(): void;
		bytes(): Uint8Array;
	};
	export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifStream;
	export function quantize(
		rgba: Uint8Array | Uint8ClampedArray,
		maxColors: number,
		options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }
	): Palette;
	export function applyPalette(
		rgba: Uint8Array | Uint8ClampedArray,
		palette: Palette,
		format?: 'rgb565' | 'rgb444' | 'rgba4444'
	): Uint8Array;
}
