import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { Gravity,ImageMagick,initializeImageMagick,MagickFormat } from '@imagemagick/magick-wasm';

const wasm=readFileSync(new URL('../../supabase/functions/bus-app-media/magick.wasm',import.meta.url));
await initializeImageMagick(wasm);
const source=readFileSync(new URL('../../supabase/functions/bus-app-media/image-core.ts',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const core=await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const runtime={Gravity,ImageMagick,MagickFormat};

test('real PNG is cropped, resized, stripped and re-encoded as WebP',()=>{
  const input=readFileSync(new URL('../../app/public/icons/icon-192.png',import.meta.url));
  const marker=Buffer.from('EXIF GPSLatitude=50.8503 GPSLongitude=4.3517 PRIVATE-MARKER');
  const processed=core.processAvatarImage(runtime,new Uint8Array(Buffer.concat([input,marker])),'PROFILE');
  assert.equal(core.detectImageFormat(processed.full),'WEBP');
  assert.equal(core.detectImageFormat(processed.thumbnail),'WEBP');
  assert.equal(processed.width,192);
  assert.equal(processed.height,192);
  assert.equal(processed.thumbnailWidth,128);
  assert.equal(processed.thumbnailHeight,128);
  assert.equal(Buffer.from(processed.full).includes(marker),false);
});

test('bus output is 4:3 and active or disguised formats are rejected',()=>{
  const input=readFileSync(new URL('../../app/public/icons/icon-192.png',import.meta.url));
  const processed=core.processAvatarImage(runtime,new Uint8Array(input),'BUS');
  assert.equal(processed.width/processed.height,4/3);
  assert.throws(()=>core.processAvatarImage(runtime,new TextEncoder().encode('<svg><script>alert(1)</script></svg>'),'PROFILE'),/IMAGE_MAGIC_INVALID/);
  assert.throws(()=>core.processAvatarImage(runtime,Uint8Array.from([0x47,0x49,0x46,0x38,0x39,0x61]),'PROFILE'),/IMAGE_MAGIC_INVALID/);
  assert.throws(()=>core.processAvatarImage(runtime,new TextEncoder().encode('%PDF-1.7'),'PROFILE'),/IMAGE_MAGIC_INVALID/);
});
