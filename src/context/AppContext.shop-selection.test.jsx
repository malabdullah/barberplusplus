import React from 'react';
import { beforeEach, it, expect, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { AppProvider, useApp } from './AppContext';

const fixture = vi.hoisted(() => {
  const empty = () => vi.fn().mockResolvedValue([]);
  const shop = { id: '70000000-0000-4000-8000-000000000001', name: 'My Shop' };
  return {
    shop,
    upload: vi.fn(),
    branches: { getAll: empty(), create: vi.fn().mockResolvedValue(shop), update: vi.fn() },
    services: { getAll: empty(), create: vi.fn().mockImplementation(async data => {
      if (!data.branchId) throw Object.assign(new Error('null value in column "branch_id" of relation "services" violates not-null constraint'), { code: '23502' });
      return { id: 'service-1', ...data };
    }) },
    bookings: { getAll: empty(), subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    user: { id: 'manager-1', app_metadata: { role: 'manager' } },
  };
});
vi.mock('../services', () => ({
  authService: {}, branchesService: fixture.branches, servicesService: fixture.services,
  barbersService: { getAll: vi.fn().mockResolvedValue([]) }, bookingsService: fixture.bookings,
  storageService: { uploadImage: fixture.upload }, loggingService: { setContext: vi.fn(), clearContext: vi.fn(), logAction: vi.fn(), logError: vi.fn() },
  notificationsService: { subscribe: vi.fn(), getAll: vi.fn().mockResolvedValue([]), getUnreadCount: vi.fn().mockResolvedValue(0) },
  notificationPreferencesService: { get: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getSession: vi.fn(async () => ({ data: { session: { user: fixture.user, access_token: 'synthetic' } } })), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) },
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) })),
  removeChannel: vi.fn(),
} }));
vi.mock('../services/agent.service', () => ({ agentService: {} }));
vi.mock('../services/customers.service', () => ({ customersService: {} }));
vi.mock('../i18n', () => ({ default: { emit: vi.fn(), changeLanguage: vi.fn(), language: 'en' } }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.branches.getAll.mockResolvedValue([]);
  fixture.branches.create.mockResolvedValue(fixture.shop);
  fixture.branches.update.mockResolvedValue({ ...fixture.shop, imageUrl: 'https://images.example.test/logo.jpg' });
  fixture.upload.mockResolvedValue('https://images.example.test/logo.jpg');
});

async function mount() {
  let app;
  function Probe() { app = useApp(); return null; }
  render(<AppProvider><Probe /></AppProvider>);
  await waitFor(() => expect(fixture.branches.getAll).toHaveBeenCalled());
  await waitFor(() => expect(app.loading).toBe(false));
  return () => app;
}

it.each(['none', 'success', 'upload-failure', 'update-failure'])('selects the first shop and saves its first service when the image result is %s', async imageResult => {
  const app = await mount();
  try {
    if (imageResult === 'upload-failure') fixture.upload.mockRejectedValueOnce(new Error('upload failed'));
    if (imageResult === 'update-failure') fixture.branches.update.mockRejectedValueOnce(new Error('image update failed'));
    expect(app().branches).toEqual([]);
    await act(async () => { await app().addBranch({ name: 'My Shop', ...(imageResult !== 'none' ? { imageFile: new File(['image'], 'logo.jpg') } : {}) }); });
    expect(app().selectedBranch.name).toBe('My Shop');
    expect(app().selectedBranchId).toBe(fixture.shop.id);
    await act(async () => { await app().addService({ name: 'Haircut', duration: 30, price: 3, branchId: 'untrusted-shop' }); });
    expect(fixture.services.create).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: fixture.shop.id, name: 'Haircut', duration: 30, price: 3 }));
    expect(app().branchServices).toHaveLength(1);
    expect(app().branchServices[0].branchId).toBe(fixture.shop.id);
    expect(app().selectedBranch.imageUrl).toBe(imageResult === 'success' ? 'https://images.example.test/logo.jpg' : undefined);
  } finally { cleanup(); }
});

it('selects a newly added second shop without attaching its service to the old shop', async () => {
  const oldShop = { id: 'old-shop', name: 'Existing Shop' };
  fixture.branches.getAll.mockResolvedValueOnce([oldShop]);
  const app = await mount();
  try {
    expect(app().selectedBranchId).toBe(oldShop.id);
    await act(async () => { await app().addBranch({ name: 'My Shop' }); });
    expect(app().branches).toHaveLength(2);
    await act(async () => { await app().addService({ name: 'Haircut', duration: 30, price: 3 }); });
    expect(app().branchServices[0].branchId).toBe(fixture.shop.id);
  } finally { cleanup(); }
});

it.each([null, 'missing-shop'])('blocks a service write with invalid selection %s before persistence', async selectedId => {
  const app = await mount();
  try {
    await act(async () => { app().setSelectedBranchId(selectedId); });
    await act(async () => { await expect(app().addService({ name: 'Haircut', duration: 30, price: 3 })).rejects.toThrow('SHOP_REQUIRED'); });
    expect(fixture.services.create).not.toHaveBeenCalled();
  } finally { cleanup(); }
});
