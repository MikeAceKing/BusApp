#!/usr/bin/env node
// Derives the responsive hero images from one source illustration.
//
// The source is a wide 2.33:1 banner with the bus on the right and open sky on the left.
// That framing is right for a tablet or desktop, but on a phone the same crop becomes a
// thin strip with a tiny bus, so a taller mobile crop centred on the bus is generated too.
//
// Usage: node scripts/generate-hero-images.mjs

import { initializeImageMagick, ImageMagick, MagickFormat, MagickGeometry } from '@imagemagick/magick-wasm';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = new URL('../app/public/media/hero/', import.meta.url);
mkdirSync(fileURLToPath(out), { recursive: true });
const source = readFileSync(fileURLToPath(new URL('../app/public/brand/herobus-source.png', import.meta.url)));
const wasm = readFileSync(fileURLToPath(new URL('../node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm', import.meta.url)));
await initializeImageMagick(wasm);

// Where the bus sits in the source, as a fraction of the full width. The mobile crop is
// centred here so the bus is never the part that gets cut away.
const busCentreX = 0.68;

function write(name, bytes) {
  writeFileSync(fileURLToPath(new URL(name, out)), bytes);
  console.log(`${name.padEnd(26)} ${(bytes.length / 1024).toFixed(1)} KB`);
}

function encode(width, crop) {
  return ImageMagick.read(source, (image) => {
    if (crop) {
      const cropHeight = image.height;
      const cropWidth = Math.min(image.width, Math.round(cropHeight * crop));
      const left = Math.max(0, Math.min(image.width - cropWidth, Math.round(image.width * busCentreX - cropWidth / 2)));
      image.crop(new MagickGeometry(left, 0, cropWidth, cropHeight));
      image.resetPage();
    }
    image.resize(width, Math.round(width * image.height / image.width));
    image.strip();
    image.quality = 82;
    return image.write(MagickFormat.WebP, (data) => Buffer.from(data));
  });
}

// Phone: 3:2, centred on the bus.
for (const width of [480, 720, 960]) write(`herobus-mobile-${width}.webp`, encode(width, 3 / 2));
// Tablet and desktop: the full banner, text sits over the open left side.
for (const width of [960, 1440, 1920]) write(`herobus-wide-${width}.webp`, encode(width, null));
console.log('\nHero images regenerated from brand/herobus-source.png.');
