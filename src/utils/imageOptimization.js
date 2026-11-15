const IMAGE_QUALITY = 0.95;
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

// APNG's animation control chunk precedes its first image data chunk.
const isAnimatedPng = async file => {
  const bytes = new DataView(await file.arrayBuffer());
  for (let offset = 8; offset + 12 <= bytes.byteLength;) {
    const type = bytes.getUint32(offset + 4);
    if (type === 0x6163544c) return true; // acTL
    if (type === 0x49444154) return false; // IDAT
    offset += bytes.getUint32(offset) + 12;
  }
  return false;
};

const hasTransparency = (context, width, height) => {
  // Inspect strips so the Safari fallback does not allocate another full image.
  for (let y = 0; y < height; y += 128) {
    const { data } = context.getImageData(0, y, width, Math.min(128, height - y));
    for (let alpha = 3; alpha < data.length; alpha += 4) {
      if (data[alpha] !== 255) return true;
    }
  }
  return false;
};

/** Preserve dimensions and fall back to the original if optimization cannot help. */
export const optimizeUploadImage = async file => {
  // Keep existing WebP quality and animation in GIF/WebP files intact.
  if (!['image/jpeg', 'image/png'].includes(file.type)) return file;

  let objectUrl;
  let image;
  let canvas;
  try {
    if (file.type === 'image/png' && await isAnimatedPng(file)) return file;
    objectUrl = URL.createObjectURL(file);
    image = new Image();
    image.src = objectUrl;
    await image.decode();

    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > MAX_CANVAS_PIXELS) return file;
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(image, 0, 0);
    const encode = type => new Promise(resolve => canvas.toBlob(resolve, type, IMAGE_QUALITY));
    let optimized = await encode('image/webp');

    // Safari falls back to PNG for WebP encoding. Keep alpha in PNG; use a
    // high-quality JPEG for opaque images instead of uploading a large PNG.
    if (optimized?.type === 'image/png' && !hasTransparency(context, width, height)) {
      const jpeg = await encode('image/jpeg');
      if (jpeg?.type === 'image/jpeg' && jpeg.size && jpeg.size < optimized.size) optimized = jpeg;
    }
    const extension = EXTENSIONS[optimized?.type];
    if (!extension || !optimized.size || optimized.size >= file.size) return file;
    return new File([optimized], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, {
      type: optimized.type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    if (image) image.src = '';
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (canvas) canvas.width = canvas.height = 0;
  }
};
