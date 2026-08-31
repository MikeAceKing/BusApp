import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

const sourceRoot = 'app/src';
const sourceFiles = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (['.ts', '.tsx', '.css'].includes(extname(path))) sourceFiles.push(path);
  }
}
walk(sourceRoot);
const source = sourceFiles.map((path) => readFileSync(path, 'utf8')).join('\n');

test('active BusApp UI uses vector icons and contains no emoji product glyph', () => {
  assert.match(source, /from 'lucide-react'/);
  assert.doesNotMatch(source, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.match(source, /busapp-mark\.svg/);
});

test('active BusApp UI contains no simulated route map', () => {
  assert.doesNotMatch(source, /\bRouteMap\b|route-map|bus-scene|bus-hero__(?:sky|road|cloud)|data-route-geometry/);
  assert.match(source, /HonestMapState/);
  assert.match(source, /routeEstimate/);
});

function pngDimensions(path) {
  const png = readFileSync(path);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test('manifest exposes complete installable PNG icon set', () => {
  const manifest = JSON.parse(readFileSync('app/public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map((icon) => [icon.sizes, icon.purpose]), [
    ['192x192', 'any'], ['512x512', 'any'], ['192x192', 'maskable'], ['512x512', 'maskable'],
  ]);
  for (const icon of manifest.icons) {
    const expected = Number(icon.sizes.split('x')[0]);
    assert.deepEqual(pngDimensions(`app/public${icon.src}`), [expected, expected]);
  }
  assert.deepEqual(pngDimensions('app/public/icons/apple-touch-icon.png'), [180, 180]);
});
