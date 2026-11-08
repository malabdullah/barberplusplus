import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ShopPublication from './ShopPublication';
const api = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock('../../services/shopPublication.service', () => ({ shopPublicationService: api }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
vi.mock('../UI/Modal', () => ({ default: ({ isOpen, children }) => isOpen ? <div role="dialog">{children}</div> : null }));
beforeEach(() => { api.manage.mockReset().mockResolvedValue({ publication_state: 'draft', ready: false }); });
afterEach(cleanup);
it('cannot publish incomplete setup', async () => {
  render(<ShopPublication branchId="shop" />);
  expect(await screen.findByRole('button', { name: 'shopPublication.publish' })).toBeDisabled();
});
it('requires confirmation and uses the server state to publish', async () => {
  api.manage.mockResolvedValueOnce({ publication_state: 'draft', ready: true }).mockResolvedValueOnce({ publication_state: 'published', ready: true });
  const changed = vi.fn(); render(<ShopPublication branchId="shop" name="Owned shop" onChanged={changed} />);
  fireEvent.click(await screen.findByRole('button', { name: 'shopPublication.publish' }));
  expect(api.manage).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog')).toHaveTextContent('Owned shop');
  fireEvent.click(screen.getAllByRole('button', { name: 'shopPublication.publish' })[1]);
  expect(await screen.findByRole('button', { name: 'shopPublication.pause' })).toBeVisible();
  expect(api.manage).toHaveBeenLastCalledWith('shop', 'publish', 'draft'); expect(changed).toHaveBeenCalledOnce();
});
it('shows failed writes and keeps the actual state', async () => {
  api.manage.mockResolvedValueOnce({ publication_state: 'published', ready: true }).mockRejectedValueOnce(new Error('network'));
  render(<ShopPublication branchId="shop" />); fireEvent.click(await screen.findByRole('button', { name: 'shopPublication.pause' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'shopPublication.pause' })[1]);
  expect(await screen.findByRole('alert')).toBeVisible(); expect(screen.getByText('shopPublication.published')).toBeVisible();
});
it('only offers the admin manual-booking exception for paused shops', async () => {
  api.manage.mockResolvedValue({ publication_state: 'paused', ready: true, paused_manual_booking_allowed: false });
  render(<ShopPublication branchId="shop" admin />);
  expect(await screen.findByRole('button', { name: 'shopPublication.allow-manual' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'shopPublication.publish' })).toBeNull();
});
