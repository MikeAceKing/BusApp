import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  assert.match(source, /busapp-mark\.png/);
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

test('every precached shell asset exists and every icon is exactly square', () => {
  // cache.addAll() rejects as a whole if any entry 404s, which would leave the app with no
  // installed service worker at all. A renamed brand asset must never break the install.
  const worker = readFileSync('app/public/service-worker.js', 'utf8');
  const shell = JSON.parse((worker.match(/const SHELL=(\[[^\]]*\])/)?.[1] || '[]').replace(/'/g, '"'));
  assert.ok(shell.length > 1, 'the service worker must precache a shell');
  for (const entry of shell) {
    if (entry === '/') continue;
    assert.ok(existsSync(join('app/public', entry)), `precached ${entry} must exist`);
  }

  // A manifest that declares a size must actually receive that size.
  const manifest = JSON.parse(readFileSync('app/public/manifest.webmanifest', 'utf8'));
  for (const icon of manifest.icons) {
    const [declared] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngDimensions(join('app/public', icon.src)), [declared, declared], `${icon.src} must be ${declared}x${declared}`);
  }
  for (const [file, size] of [['app/public/favicon-32.png', 32], ['app/public/favicon-180.png', 180], ['app/public/brand/busapp-mark.png', 128]]) {
    assert.deepEqual(pngDimensions(file), [size, size], `${file} must be ${size}x${size}`);
  }

  // Every icon is generated from one source, so the brand cannot drift apart.
  assert.ok(existsSync('app/public/brand/buslogo-source.png'), 'the source logo must stay in the repository');
  const generator = readFileSync('scripts/generate-brand-icons.mjs', 'utf8');
  assert.match(generator, /brand\/buslogo-source\.png/);
});
