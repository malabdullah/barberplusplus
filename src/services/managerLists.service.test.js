import { beforeEach, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => {
  const chain = {};
  for (const name of ['select', 'eq', 'in', 'order']) chain[name] = vi.fn(() => chain);
  chain.then = resolve => resolve({ data: [], error: null });
  return { chain, from: vi.fn(() => chain) };
});
vi.mock('../lib/supabase', () => ({ supabase: { from: query.from } }));
import { barbersService } from './barbers.service';
import { servicesService } from './services.service';
import { bookingsService } from './bookings.service';
beforeEach(() => vi.clearAllMocks());
it.each([
  ['barbers', ids => barbersService.getAll(ids)],
  ['services', ids => servicesService.getAll(ids)],
  ['bookings', ids => bookingsService.getAll({ branchIds: ids })],
])('scopes %s to all authorized shops and skips a query when the manager has none', async (_, load) => {
  await load(['own-a', 'own-b']);
  expect(query.chain.in).toHaveBeenCalledWith('branch_id', ['own-a', 'own-b']);
  vi.clearAllMocks();
  await expect(load([])).resolves.toEqual([]);
  expect(query.chain.order).not.toHaveBeenCalled();
  expect(query.chain.in).not.toHaveBeenCalled();
});
it('preserves the existing single-shop and unfiltered callers', async () => {
  await servicesService.getAll('shop');
  expect(query.chain.eq).toHaveBeenCalledWith('branch_id', 'shop');
  vi.clearAllMocks();
  await barbersService.getAll();
  expect(query.chain.eq).not.toHaveBeenCalled();
  expect(query.chain.in).not.toHaveBeenCalled();
  expect(query.chain.order).toHaveBeenCalledWith('name');
});
