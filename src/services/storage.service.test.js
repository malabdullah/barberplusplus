import { beforeEach, expect, it, vi } from 'vitest';
import { supabase } from '../lib/supabase';
import { storageService } from './storage.service';

vi.mock('../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));
const remove = vi.fn().mockResolvedValue({ error: null });
beforeEach(() => {
  vi.clearAllMocks();
  supabase.storage.from.mockReturnValue({ remove });
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
