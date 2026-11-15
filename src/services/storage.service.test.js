import { beforeEach, expect, it, vi } from 'vitest';
import { supabase } from '../lib/supabase';
import { storageService } from './storage.service';
import { optimizeUploadImage } from '../utils/imageOptimization';

vi.mock('../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));
vi.mock('../utils/imageOptimization', () => ({ optimizeUploadImage: vi.fn() }));
const remove = vi.fn().mockResolvedValue({ error: null });
const upload = vi.fn().mockResolvedValue({ error: null });
const getPublicUrl = vi.fn(path => ({ data: { publicUrl: `https://images.example/${path}` } }));
beforeEach(() => {
  vi.clearAllMocks();
  supabase.storage.from.mockReturnValue({ remove, upload, getPublicUrl });
});
it.each(['branches', 'barbers'])('uploads the optimized image with matching extension and MIME type for %s', async folder => {
  const source = new File(['source image'], 'photo.png', { type: 'image/png' });
  const optimized = new File(['webp'], 'photo.webp', { type: 'image/webp' });
  optimizeUploadImage.mockResolvedValue(optimized);
  const url = await storageService.uploadImage(source, folder, 'person');
  expect(optimizeUploadImage).toHaveBeenCalledWith(source);
  expect(upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${folder}/person-[0-9]+\\.webp$`)), optimized,
    expect.objectContaining({ contentType: 'image/webp', upsert: false }));
  expect(url).toMatch(/\.webp$/);
});
it('preserves upload validation before attempting optimization', async () => {
  const invalid = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' });
  await expect(storageService.uploadImage(invalid, 'branches', 'shop')).rejects.toThrow('File too large');
  expect(optimizeUploadImage).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});
it('keeps other profile upload paths unchanged', async () => {
  const source = new File(['source'], 'photo.png', { type: 'image/png' });
  await storageService.uploadImage(source, 'profiles', 'person');
  expect(optimizeUploadImage).not.toHaveBeenCalled();
  expect(upload).toHaveBeenCalledWith(expect.stringMatching(/\.png$/), source, expect.objectContaining({ contentType: 'image/png' }));
});
it('cleans up an image bound to the edited barber', async () => {
  await storageService.deleteImage('https://legacy.example/storage/v1/object/public/avatars/barbers/person-123.png', 'barbers', 'person');
  expect(remove).toHaveBeenCalledWith(['barbers/person-123.png']);
});
it('leaves another entity image intact', async () => {
  await storageService.deleteImage('https://images.example/storage/v1/object/public/avatars/barbers/other-123.png', 'barbers', 'person');
  expect(remove).not.toHaveBeenCalled();
});
it('retains profile cleanup and refuses incomplete cleanup context', async () => {
  const url = 'https://images.example/storage/v1/object/public/avatars/profiles/person-123.png';
  await storageService.deleteImage(url);
  expect(remove).not.toHaveBeenCalled();
  await storageService.deleteImage(url, 'profiles', 'person');
  expect(remove).toHaveBeenCalledWith(['profiles/person-123.png']);
});
