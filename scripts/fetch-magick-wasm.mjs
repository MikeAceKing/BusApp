#!/usr/bin/env node
// Copies the ImageMagick WASM binary out of the pinned npm dependency and places it beside
// the bus-app-media function, where the deployed bundle can always find it.
//
// The binary is a build artifact, not source, so it is not committed to this public repo.

import { copyFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The package ships an x86 (32-bit memory model) and an x64 build. BusApp pins x86: it is
// the smaller binary and the one the deployed function was verified against.
const source = fileURLToPath(new URL('../node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm', import.meta.url));
const target = fileURLToPath(new URL('../supabase/functions/bus-app-media/magick.wasm', import.meta.url));

if (!existsSync(source)) {
  console.error(`Missing ${source}. Run "npm install" first.`);
  process.exit(1);
}
copyFileSync(source, target);
console.log(`Wrote ${target} (${(statSync(target).size / 1024 / 1024).toFixed(1)} MB).`);
