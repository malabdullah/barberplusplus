import { beforeEach, expect, it, vi } from 'vitest';
import { functionFetch } from '../lib/functionFetch';
import { customerBookingService } from './customerBooking.service';
import { searchBranches } from '../utils/customerBooking';

vi.mock('../lib/runtimeConfig', () => ({ appConfig: { supabaseUrl: 'https://example.test', supabasePublishableKey: 'public-test-key' }, customerFeaturesEnabled: true }));
vi.mock('../lib/functionFetch', () => ({ functionFetch: vi.fn() }));
vi.mock('./customerAuth.service', () => ({ customerToken: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it('preserves real zero statistics and discards fields outside the public counts', async () => {
  functionFetch.mockResolvedValue({ok:true,json:async () => ({shops:0,monthlyBookings:0,barbers:0,privateRows:['not public']})});
  await expect(customerBookingService.getStatistics()).resolves.toEqual({shops:0,monthlyBookings:0,barbers:0});
});

it.each([null,-1,'500+',Infinity])('rejects unavailable or invalid statistics: %s', async value => {
  functionFetch.mockResolvedValue({ok:true,json:async () => ({shops:value,monthlyBookings:0,barbers:0})});
  await expect(customerBookingService.getStatistics()).rejects.toThrow('UNAVAILABLE');
});

it('uses saved area names for blank, missing and stale city text', async () => {
  const records = [
    { id: 'legacy', name: 'Legacy shop', city: null, areas: { name_en: 'Hawalli', name_ar: 'حولي' } },
    { id: 'blank', name: 'Blank city shop', city: '  ', areas: { name_en: 'Salmiya', name_ar: 'السالمية' } },
    { id: 'explicit', name: 'Explicit city shop', city: 'Kuwait City', areas: { name_en: 'Qibla', name_ar: 'القبلة' } },
    { id: 'unlocated', name: 'Unlocated shop', city: null, areas: null },
  ];
  functionFetch.mockResolvedValue({ ok: true, json: async () => ({ branches: records, barbers: [], services: [] }) });
  const { branches } = await customerBookingService.getCatalog();
  expect(searchBranches(branches, 'Hawalli', '')).toMatchObject([{ id: 'legacy', cityAr: 'حولي' }]);
  expect(branches[1]).toMatchObject({ city: 'Salmiya', cityAr: 'السالمية' });
  expect(branches[2]).toMatchObject({ city: 'Qibla', cityAr: 'القبلة' });
  expect(searchBranches(branches, 'Kuwait City', '')).toEqual([]);
  expect(branches[3].city).toBe('');
  expect(records[0].city).toBeNull();
  expect(records[1].city).toBe('  ');
});

it('preserves governorate labels and falls back to the saved area relation', async () => {
  const governorate = { id: 2, name_en: 'Hawalli', name_ar: 'حولي' };
  functionFetch.mockResolvedValue({ ok: true, json: async () => ({ branches: [
    { id: 'direct', city: 'New district', governorates: governorate },
    { id: 'area', city: null, areas: { name_en: 'New district', name_ar: 'منطقة جديدة', governorates: governorate } },
  ], barbers: [], services: [] }) });
  const { branches } = await customerBookingService.getCatalog();
  for (const branch of branches) expect(branch).toMatchObject({ city: 'New district', governorateId: 2, governorateName: 'Hawalli', governorateNameAr: 'حولي' });
});

it('keeps the canonical Arabic area and the city-name fallback for unmapped shops', async () => {
  functionFetch.mockResolvedValue({ ok: true, json: async () => ({ branches: [
    { id: 'matched', city: '  Sharq  ', areas: { name_en: 'Sharq', name_ar: 'شرق' } },
    { id: 'different', city: 'Mirqab', areas: { name_en: 'Sharq', name_ar: 'شرق' } },
    { id: 'legacy', city: '  Mirqab  ', areas: null },
  ], barbers: [], services: [] }) });
  const { branches } = await customerBookingService.getCatalog();
  expect(branches[0]).toMatchObject({ city: 'Sharq', cityAr: 'شرق' });
  expect(branches[1]).toMatchObject({ city: 'Sharq', cityAr: 'شرق' });
  expect(branches[2]).toMatchObject({ city: 'Mirqab', cityAr: '' });
});

it('keeps the native-compatible shop-access error while showing specific website wording', async () => {
  functionFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'BOOKING_UNAVAILABLE', reason: 'SHOP_ACCESS_REQUIRED' }) });
  await expect(customerBookingService.getCatalog()).rejects.toThrow('BILLING_BOOKING_UNAVAILABLE');
});
