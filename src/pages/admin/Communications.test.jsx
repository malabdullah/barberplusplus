import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import Communications from './Communications';
import en from '../../i18n/locales/en.json';
import { adminPushService } from '../../services/adminPush.service';
vi.mock('../../services/adminPush.service', () => ({
  adminPushService: {
    history: vi.fn(),
    options: vi.fn(),
    users: vi.fn(),
    preview: vi.fn(),
    send: vi.fn(),
    recipients: vi.fn(),
    audiences: vi.fn(),
    saveAudience: vi.fn(),
    deleteAudience: vi.fn(),
    barbers: vi.fn(),
    duplicate: vi.fn(),
    cancel: vi.fn(),
  },
}));
const campaign = {
  id: 'a0000000-0000-4000-8000-000000000001',
  titleEn: 'A new offer',
  bodyEn: 'Book your next haircut',
  titleAr: '',
  bodyAr: '',
  destination: 'book',
  matchedUsers: 2,
  eligibleUsers: 1,
  excludedUsers: 1,
  devices: 1,
  previewExpiresAt: '2030-01-01T12:00:00Z',
  createdAt: '2030-01-01T11:45:00Z',
  queuedAt: '2030-01-01T11:46:00Z',
  results: { captured: 1 },
};
async function mount() {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <Communications />
    </I18nextProvider>,
  );
}
async function compose() {
  await screen.findByText(en.announcements.empty);
  fireEvent.click(screen.getByRole('button', { name: en.announcements.new }));
  fireEvent.change(screen.getByLabelText(en.announcements.titleEn), {
    target: { value: campaign.titleEn },
  });
  fireEvent.change(screen.getByLabelText(en.announcements.bodyEn), {
    target: { value: campaign.bodyEn },
  });
  fireEvent.click(
    screen.getByRole('button', { name: en.announcements.chooseAudience }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  adminPushService.history.mockResolvedValue({ campaigns: [], total: 0 });
  adminPushService.options.mockResolvedValue({
    governorates: [],
    cities: [],
    shops: [],
    shopTotal: 0,
    delivery: { enabled: true, mode: 'capture' },
  });
  adminPushService.audiences.mockResolvedValue({ audiences: [], total: 0 });
  adminPushService.users.mockResolvedValue({ users: [], total: 0 });
  adminPushService.preview.mockResolvedValue({
    campaign,
    delivery: { mode: 'capture' },
  });
  adminPushService.send.mockResolvedValue({ campaign });
});
afterEach(cleanup);
describe('admin announcement review and send', () => {
  it('requires a preview and explicit confirmation, then sends only the frozen campaign', async () => {
    await mount();
    await compose();
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.review }),
    );
    await screen.findByText(en.announcements.captureMode);
    const send = screen.getByRole('button', {
      name: en.announcements.sendCapture,
    });
    expect(send).toBeDisabled();
    expect(adminPushService.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() =>
      expect(adminPushService.send).toHaveBeenCalledExactlyOnceWith(campaign.id)
    );
    expect(adminPushService.preview.mock.calls[0][0].filters).toEqual({
      excludeIds: [],
    });
  });
  it('keeps zero recipients unsendable even in capture mode', async () => {
    adminPushService.preview.mockResolvedValue({
      campaign: { ...campaign, devices: 0, eligibleUsers: 0 },
      delivery: { mode: 'capture' },
    });
    await mount();
    await compose();
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.review }),
    );
    await screen.findByText(en.announcements.captureMode);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: en.announcements.sendCapture }))
      .toBeDisabled();
  });
  it('does not silently create a second campaign after an uncertain send response', async () => {
    adminPushService.send.mockRejectedValueOnce(Error('UNAVAILABLE'));
    await mount();
    await compose();
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.review }),
    );
    await screen.findByText(en.announcements.captureMode);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.sendCapture }),
    );
    await screen.findByRole('alert');
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.sendCapture }),
    );
    await waitFor(() => expect(adminPushService.send).toHaveBeenCalledTimes(2));
    expect(adminPushService.send.mock.calls).toEqual([[campaign.id], [
      campaign.id,
    ]]);
    expect(adminPushService.preview).toHaveBeenCalledTimes(1);
  });
  it('preserves exact individually selected accounts when previewing', async () => {
    adminPushService.users.mockResolvedValue({
      users: [{
        id: 'selected-user',
        name: 'QA Customer',
        email: 'qa@example.test',
        role: 'customer',
        devices: 1,
      }],
      total: 1,
    });
    await mount();
    await compose();
    fireEvent.click(screen.getByLabelText(en.announcements.modes.selected));
    expect(screen.getByRole('button', { name: en.announcements.review }))
      .toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.search }),
    );
    await screen.findByText('QA Customer');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.review }),
    );
    await waitFor(() => expect(adminPushService.preview).toHaveBeenCalled());
    expect(adminPushService.preview.mock.calls[0][0].filters.userIds).toEqual([
      'selected-user',
    ]);
  });
  it('labels captured results honestly and exposes paginated admin details', async () => {
    adminPushService.history.mockResolvedValue({
      campaigns: [campaign],
      total: 1,
    });
    adminPushService.recipients.mockResolvedValue({
      campaign,
      users: [{
        id: 'qa',
        name: 'QA Customer',
        email: 'qa@example.test',
        devices: 1,
        results: { captured: 1 },
      }],
    });
    await mount();
    await screen.findByText(campaign.titleEn);
    expect(screen.getByText(en.announcements.states.captured))
      .toBeInTheDocument();
    expect(screen.queryByText(en.announcements.states.accepted)).not
      .toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.details }),
    );
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('QA Customer');
    expect(adminPushService.recipients).toHaveBeenCalledWith(campaign.id, 1);
    fireEvent.click(
      within(dialog).getAllByRole('button', {
        name: en.announcements.close,
      })[0],
    );
    await waitFor(() => expect(dialog.open).toBe(false));
  });
});

describe('phase2 scheduling and lifecycle', () => {
  it('freezes the explicitly chosen Kuwait time in preview', async () => {
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    await mount();
    await screen.findByText(en.announcements.empty);
    fireEvent.click(screen.getByRole('button', { name: en.announcements.new }));
    fireEvent.change(screen.getByLabelText(en.announcements.titleEn), {
      target: { value: 'Schedule QA' },
    });
    fireEvent.change(screen.getByLabelText(en.announcements.bodyEn), {
      target: { value: 'Test only' },
    });
    fireEvent.click(screen.getByLabelText(en.announcements.schedule));
    fireEvent.change(screen.getByLabelText(en.announcements.scheduledTime), {
      target: { value: `${day}T12:30` },
    });
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.chooseAudience }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.review }),
    );
    await waitFor(() => expect(adminPushService.preview).toHaveBeenCalled());
    expect(adminPushService.preview.mock.calls[0][0].scheduledAt).toBe(
      `${day}T09:30:00.000Z`,
    );
  });
  it('duplicates into an editable unscheduled draft without sending', async () => {
    adminPushService.history.mockResolvedValue({
      campaigns: [{
        ...campaign,
        state: 'scheduled',
        scheduledAt: '2030-01-01T12:30:00Z',
      }],
      total: 1,
    });
    adminPushService.duplicate.mockResolvedValue({
      draft: {
        titleEn: 'Copied title',
        bodyEn: 'Copied body',
        titleAr: '',
        bodyAr: '',
        destination: 'book',
        filters: { roles: ['customer'] },
      },
    });
    await mount();
    fireEvent.click(
      await screen.findByRole('button', { name: en.announcements.duplicate }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(en.announcements.titleEn)).toHaveValue(
        'Copied title',
      )
    );
    expect(screen.getByLabelText(en.announcements.sendNow)).toBeChecked();
    expect(adminPushService.send).not.toHaveBeenCalled();
    expect(adminPushService.preview).not.toHaveBeenCalled();
  });
  it('requires explicit cancellation and never calls send to cancel', async () => {
    const scheduled = {
      ...campaign,
      state: 'scheduled',
      results: { pending: 1 },
      scheduledAt: '2030-01-01T12:30:00Z',
    };
    adminPushService.history.mockResolvedValue({
      campaigns: [scheduled],
      total: 1,
    });
    adminPushService.cancel.mockResolvedValue({
      campaign: { ...scheduled, state: 'cancelled' },
    });
    await mount();
    fireEvent.click(
      await screen.findByRole('button', {
        name: en.announcements.cancelCampaign,
      }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: en.announcements.cancelCampaign,
    });
    expect(adminPushService.cancel).not.toHaveBeenCalled();
    expect(within(dialog).getByText(en.announcements.cancelWarning))
      .toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: en.announcements.confirmCancel,
      }),
    );
    await waitFor(() =>
      expect(adminPushService.cancel).toHaveBeenCalledExactlyOnceWith(
        campaign.id,
      )
    );
    expect(adminPushService.send).not.toHaveBeenCalled();
  });
  it('applies saved criteria but still requires a fresh preview', async () => {
    adminPushService.audiences.mockResolvedValue({
      audiences: [{
        id: 'returning',
        name: 'Returning',
        filters: { maxCompleted: 0 },
      }],
      total: 1,
    });
    await mount();
    await compose();
    fireEvent.click(screen.getByLabelText(en.announcements.modes.filtered));
    await screen.findByRole('option', { name: 'Returning' });
    fireEvent.change(
      screen.getByRole('combobox', { name: en.announcements.savedAudiences }),
      { target: { value: 'returning' } },
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: en.announcements.applyAudience }),
      ).toBeEnabled()
    );
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.applyAudience }),
    );
    expect(screen.getByLabelText(en.announcements.maxCompleted)).toHaveValue(0);
    fireEvent.click(
      screen.getByRole('button', { name: en.announcements.review }),
    );
    await waitFor(() => expect(adminPushService.preview).toHaveBeenCalled());
    expect(adminPushService.preview.mock.calls[0][0].filters.maxCompleted).toBe(
      0,
    );
    expect(adminPushService.send).not.toHaveBeenCalled();
  });
});

it('switching a duplicated selection to filters does not retain hidden selected IDs', async () => {
  adminPushService.history.mockResolvedValue({
    campaigns: [campaign],
    total: 1,
  });
  adminPushService.duplicate.mockResolvedValue({
    draft: {
      titleEn: 'Copy',
      bodyEn: 'Copy body',
      titleAr: '',
      bodyAr: '',
      destination: 'book',
      filters: { userIds: ['old-selected'], excludeIds: ['old-excluded'] },
    },
    users: [{ id: 'old-selected', name: 'Previously selected' }, {
      id: 'old-excluded',
      name: 'Previously excluded',
    }],
  });
  await mount();
  fireEvent.click(
    await screen.findByRole('button', { name: en.announcements.duplicate }),
  );
  await screen.findByDisplayValue('Copy');
  fireEvent.click(
    screen.getByRole('button', { name: en.announcements.chooseAudience }),
  );
  fireEvent.click(screen.getByLabelText(en.announcements.modes.filtered));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: en.announcements.review }))
      .toBeEnabled()
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.announcements.review }),
  );
  await waitFor(() => expect(adminPushService.preview).toHaveBeenCalled());
  const filters = adminPushService.preview.mock.calls[0][0].filters;
  expect(filters.userIds).toBeUndefined();
  expect(filters.excludeIds).toEqual(['old-excluded']);
});
