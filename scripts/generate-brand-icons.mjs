#!/usr/bin/env node
// Regenerates every BusApp icon from the single source logo, so the app icon, the favicon,
// the PWA icons and the in-app wordmark can never drift apart.
//
// Uses the pinned @imagemagick/magick-wasm dependency, so no extra toolchain is needed.
//
// Usage: node scripts/generate-brand-icons.mjs

import { initializeImageMagick, ImageMagick, MagickColor, MagickFormat } from '@imagemagick/magick-wasm';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../app/public/', import.meta.url);
const source = readFileSync(fileURLToPath(new URL('brand/buslogo-source.png', root)));
const wasm = readFileSync(fileURLToPath(new URL('../node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm', import.meta.url)));
await initializeImageMagick(wasm);

// The brand blue, matching the theme-color in index.html. Maskable and Apple icons are
// flattened onto it: a mask must never reveal the transparent corners of the rounded square.
const brandBlue = '#1686d9';

function write(relativePath, bytes) {
  const target = fileURLToPath(new URL(relativePath, root));
  mkdirSync(fileURLToPath(new URL('.', new URL(relativePath, root))), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`${relativePath.padEnd(34)} ${(bytes.length / 1024).toFixed(1)} KB`);
}

// The source PNG has a transparent margin around the rounded square. Trimming it first
// means every generated icon is edge-to-edge artwork instead of a small logo floating in
// empty space, which matters most at favicon sizes.
function trimmed(image) {
  image.trim();
  image.resetPage();
}

// `any` icons keep transparent corners: the platform draws the rounded square as-is.
// resize() preserves aspect ratio, so the result is padded back to an exact square: a
// manifest that declares 192x192 must actually receive a 192x192 file.
function transparentIcon(size) {
  return ImageMagick.read(source, (image) => {
    trimmed(image);
    image.resize(size, size);
    image.backgroundColor = new MagickColor(0, 0, 0, 0);
    image.extent(size, size, 5 /* Gravity.Center */);
    return image.write(MagickFormat.Png, (data) => Buffer.from(data));
  });
}

// Maskable/Apple icons are opaque. The artwork is inset so a circular or squircle mask
// cannot clip the bus, and the remaining area is filled with the brand blue.
function opaqueIcon(size, inset) {
  return ImageMagick.read(source, (image) => {
    trimmed(image);
    const artwork = Math.round(size * inset);
    image.resize(artwork, artwork);
    image.backgroundColor = new MagickColor(brandBlue);
    image.extent(size, size, 5 /* Gravity.Center */);
    image.alpha(1 /* AlphaOption.Remove */);
    return image.write(MagickFormat.Png, (data) => Buffer.from(data));
  });
}

write('icons/icon-192.png', transparentIcon(192));
write('icons/icon-512.png', transparentIcon(512));
// A maskable icon's safe zone is the centred 80% circle, so the artwork is inset to fit it.
write('icons/maskable-192.png', opaqueIcon(192, 0.8));
write('icons/maskable-512.png', opaqueIcon(512, 0.8));
// iOS applies its own rounding and dislikes transparency, so this one is full-bleed opaque.
write('icons/apple-touch-icon.png', opaqueIcon(180, 1));
write('favicon-32.png', transparentIcon(32));
write('favicon-180.png', transparentIcon(180));
// The in-app wordmark icon next to "BusApp".
write('brand/busapp-mark.png', transparentIcon(128));
console.log('\nAll BusApp icons regenerated from brand/buslogo-source.png.');
