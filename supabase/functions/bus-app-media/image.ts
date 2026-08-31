import { Gravity, ImageMagick, initializeImageMagick, MagickFormat } from 'npm:@imagemagick/magick-wasm@0.0.43';
import { processAvatarImage, type AvatarImageKind, type MagickRuntimeLike, type ProcessedAvatarImage } from './image-core.ts';

export type { AvatarImageKind } from './image-core.ts';

// Keep the WASM beside the function so the hosted bundle cannot lose the npm
// package's exported binary during dependency graph rewriting.
const wasmBytes = await Deno.readFile(new URL('./magick.wasm', import.meta.url));
await initializeImageMagick(wasmBytes);

const runtime = { Gravity, ImageMagick, MagickFormat } as unknown as MagickRuntimeLike;

export function sanitizeAvatarImage(bytes: Uint8Array, kind: AvatarImageKind): ProcessedAvatarImage {
  return processAvatarImage(runtime, bytes, kind);
}
