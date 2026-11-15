import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { optimizeUploadImage } from './imageOptimization';

let canvas;
let context;
let image;
let encoded;
const file = (type = 'image/jpeg') => {
  const input = new File([new Uint8Array(5000)], `upload.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`, { type });
  input.arrayBuffer = async () => new ArrayBuffer(0);
  return input;
};

beforeEach(() => {
  encoded = [];
  image = { naturalWidth: 1254, naturalHeight: 1254, decode: vi.fn().mockResolvedValue(), src: '' };
  vi.stubGlobal('Image', class { constructor() { return image; } });
  vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:test'), revokeObjectURL: vi.fn() });
  context = { drawImage: vi.fn(), getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray([0, 0, 0, 255]) }) };
  canvas = {
    getContext: vi.fn().mockReturnValue(context),
    toBlob: vi.fn((callback, type) => {
      encoded.push([canvas.width, canvas.height]);
      callback(new Blob(['optimized'], { type }));
    }),
  };
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['image/jpeg', 'image/png'])('compresses %s without resizing and releases image resources', async type => {
  const result = await optimizeUploadImage(file(type));
  expect(result.name).toBe('upload.webp');
  expect(result.type).toBe('image/webp');
  expect(result.size).toBeLessThan(5000);
  expect(encoded).toEqual([[1254, 1254]]);
  expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.95);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  expect(canvas.width).toBe(0);
  expect(image.src).toBe('');
});

it.each([null, new Blob([]), new Blob([new Uint8Array(6000)], { type: 'image/webp' })])('keeps the original when the encoder cannot produce a smaller image', async output => {
  canvas.toBlob.mockImplementation(callback => callback(output));
  const input = file();
  expect(await optimizeUploadImage(input)).toBe(input);
});

it('uses high-quality JPEG on browsers without a WebP encoder', async () => {
  canvas.toBlob.mockImplementation((callback, type) => callback(new Blob([new Uint8Array(type === 'image/webp' ? 4000 : 500)], {
    type: type === 'image/webp' ? 'image/png' : type,
  })));
  const result = await optimizeUploadImage(file('image/png'));
  expect(result.type).toBe('image/jpeg');
  expect(result.name).toBe('upload.jpg');
  expect(canvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), 'image/jpeg', 0.95);
});

it('preserves transparency in the PNG fallback', async () => {
  context.getImageData.mockReturnValue({ data: new Uint8ClampedArray([20, 40, 60, 0]) });
  canvas.toBlob.mockImplementation(callback => callback(new Blob(['smaller png'], { type: 'image/png' })));
  const result = await optimizeUploadImage(file('image/png'));
  expect(result.type).toBe('image/png');
  expect(result.name).toBe('upload.png');
  expect(canvas.toBlob).toHaveBeenCalledTimes(1);
});

it('keeps animation and already encoded WebP intact', async () => {
  const animated = file('image/png');
  const bytes = new ArrayBuffer(28);
  new DataView(bytes).setUint32(12, 0x6163544c); // acTL
  animated.arrayBuffer = async () => bytes;
  for (const input of [animated, file('image/gif'), file('image/webp')]) {
    expect(await optimizeUploadImage(input)).toBe(input);
  }
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('falls back safely on decode failure and excessive pixel count', async () => {
  const input = file();
  image.decode.mockRejectedValueOnce(new Error('Cannot decode'));
  expect(await optimizeUploadImage(input)).toBe(input);
  image.naturalWidth = image.naturalHeight = 8000;
  expect(await optimizeUploadImage(input)).toBe(input);
  expect(canvas.toBlob).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
