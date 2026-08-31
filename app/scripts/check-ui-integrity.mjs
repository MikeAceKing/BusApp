import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = new URL('../src/', import.meta.url);
const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const forbiddenRuntime = /\bRouteMap\b|route-map|bus-scene|bus-hero__(?:sky|road|cloud)|data-route-geometry/;
const failures = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (['.ts', '.tsx', '.css'].includes(extname(entry.name))) {
      const source = readFileSync(path, 'utf8');
      if (emoji.test(source)) failures.push(`${relative(root.pathname, path)} contains an emoji product glyph`);
      if (forbiddenRuntime.test(source)) failures.push(`${relative(root.pathname, path)} contains a forbidden simulated-map runtime`);
    }
  }
}

walk(root.pathname);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('BusApp UI integrity: no emoji product glyphs or simulated-map runtime.');
