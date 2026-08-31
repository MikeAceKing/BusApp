export type AcceptedImageFormat = 'JPEG' | 'PNG' | 'WEBP';
export type AvatarImageKind = 'PROFILE' | 'BUS';

type MagickImageLike = {
  width: number;
  height: number;
  quality: number;
  autoOrient(): void;
  crop(width: number, height: number, gravity: number): void;
  resetPage(): void;
  resize(width: number, height: number): void;
  strip(): void;
  write<T>(format: string, callback: (data: Uint8Array) => T): T;
};

export type MagickRuntimeLike = {
  ImageMagick: {
    readCollection<T>(data: Uint8Array, format: string, callback: (images: MagickImageLike[]) => T): T;
  };
  MagickFormat: { Jpeg: string; Png: string; WebP: string };
  Gravity: { Center: number };
};

export type ProcessedAvatarImage = {
  full: Uint8Array;
  thumbnail: Uint8Array;
  width: number;
  height: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
};

export function detectImageFormat(bytes: Uint8Array): AcceptedImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'PNG';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'WEBP';
  return null;
}

function transform(runtime: MagickRuntimeLike, bytes: Uint8Array, inputFormat: string, width: number, height: number, aspect: number): { bytes: Uint8Array; width: number; height: number } {
  return runtime.ImageMagick.readCollection(bytes, inputFormat, (images) => {
    if (images.length !== 1) throw new Error('ANIMATED_IMAGE_NOT_ALLOWED');
    const image = images[0];
    image.autoOrient();
    if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width < 1 || image.height < 1 || image.width > 12000 || image.height > 12000 || image.width * image.height > 50_000_000) throw new Error('IMAGE_DIMENSIONS_INVALID');
    const currentAspect = image.width / image.height;
    if (currentAspect > aspect) image.crop(Math.max(1, Math.round(image.height * aspect)), image.height, runtime.Gravity.Center);
    else if (currentAspect < aspect) image.crop(image.width, Math.max(1, Math.round(image.width / aspect)), runtime.Gravity.Center);
    image.resetPage();
    const scale = Math.min(1, width / image.width, height / image.height);
    const outputWidth = Math.max(1, Math.round(image.width * scale));
    const outputHeight = Math.max(1, Math.round(image.height * scale));
    if (outputWidth !== image.width || outputHeight !== image.height) image.resize(outputWidth, outputHeight);
    image.strip();
    image.quality = 82;
    return { bytes: image.write(runtime.MagickFormat.WebP, (data) => Uint8Array.from(data)), width: image.width, height: image.height };
  });
}

export function processAvatarImage(runtime: MagickRuntimeLike, bytes: Uint8Array, kind: AvatarImageKind): ProcessedAvatarImage {
  const detected = detectImageFormat(bytes);
  if (!detected) throw new Error('IMAGE_MAGIC_INVALID');
  const inputFormat = detected === 'JPEG' ? runtime.MagickFormat.Jpeg : detected === 'PNG' ? runtime.MagickFormat.Png : runtime.MagickFormat.WebP;
  const aspect = kind === 'BUS' ? 4 / 3 : 1;
  const full = transform(runtime, bytes, inputFormat, kind === 'BUS' ? 1600 : 1024, kind === 'BUS' ? 1200 : 1024, aspect);
  const thumbnail = transform(runtime, bytes, inputFormat, kind === 'BUS' ? 320 : 128, kind === 'BUS' ? 240 : 128, aspect);
  return { full: full.bytes, thumbnail: thumbnail.bytes, width: full.width, height: full.height, thumbnailWidth: thumbnail.width, thumbnailHeight: thumbnail.height };
}
