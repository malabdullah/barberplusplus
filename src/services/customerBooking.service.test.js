import { beforeEach, expect, it, vi } from 'vitest';
import { functionFetch } from '../lib/functionFetch';
import { customerBookingService } from './customerBooking.service';
import { searchBranches } from '../utils/customerBooking';

vi.mock('../lib/runtimeConfig', () => ({ appConfig: { supabaseUrl: 'https://example.test', supabasePublishableKey: 'public-test-key' }, customerFeaturesEnabled: true }));
vi.mock('../lib/functionFetch', () => ({ functionFetch: vi.fn() }));
vi.mock('./customerAuth.service', () => ({ customerToken: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it('makes legacy shops searchable by their saved area when city is absent, without changing records', async () => {
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
  expect(branches[2]).toMatchObject({ city: 'Kuwait City', cityAr: '' });
  expect(branches[3].city).toBe('');
  expect(records[0].city).toBeNull();
  expect(records[1].city).toBe('  ');
});
