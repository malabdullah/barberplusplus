import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ from: vi.fn(), channel: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: db }));
import { notificationsService, preferenceFilter } from './notifications.service';
import { notificationPreferencesService } from './notificationPreferences.service';

describe('dashboard notification persistence', () => {
  let query;
  beforeEach(() => {
    vi.clearAllMocks();
    query = { data: [], count: 81, error: null };
    for (const method of ['select', 'order', 'range', 'or', 'eq', 'update']) query[method] = vi.fn(() => query);
    db.from.mockReturnValue(query);
  });
  it('returns the saved database ID and filters full counts using the same preferences', async () => {
    query.data = [{ id: 'database-id', is_read: false, metadata: {} }];
    const prefs = { ...notificationPreferencesService.DEFAULT_PREFERENCES, bookingUpdates: false };
    expect((await notificationsService.getAll({ preferences: prefs }))[0].id).toBe('database-id');
    const historyFilter = query.or.mock.calls[0][0];
    expect(await notificationsService.getUnreadCount(prefs)).toBe(81);
    expect(query.or.mock.calls[1][0]).toBe(historyFilter);
    expect(historyFilter).not.toContain('type.eq.booking_updated');
    expect(historyFilter).not.toContain('type.eq.booking_reassigned');
  });
  it('applies enable cutoffs and does not expose disabled categories in a badge', () => {
    const filter = preferenceFilter({ ...notificationPreferencesService.DEFAULT_PREFERENCES, newBookings: false, bookingUpdatesEnabledAt: '2026-11-02T10:00:00Z' });
    expect(filter).not.toContain('type.eq.booking_created');
    expect(filter).toContain('and(type.eq.booking_updated,created_at.gte.2026-11-02T10:00:00.000Z)');
  });
  it('marks read idempotently without fabricating local IDs or decrementing counts', async () => {
    await notificationsService.markRead('saved-id');
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ is_read: true }));
    expect(query.eq.mock.calls).toEqual([['id', 'saved-id'], ['is_read', false]]);
  });
  it('subscribes to the recipient on the server and requests catch-up after reconnect', () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
    db.channel.mockReturnValue(channel);
    const insert = vi.fn(), update = vi.fn(), catchUp = vi.fn();
    notificationsService.subscribe(insert, update, 'my-id', catchUp);
    expect(channel.on.mock.calls[0][1].filter).toBe('recipient_user_id=eq.my-id');
    channel.on.mock.calls[0][2]({ new: { id: 'persisted', metadata: {} } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'persisted' }));
    channel.subscribe.mock.calls[0][0]('SUBSCRIBED');
    channel.subscribe.mock.calls[0][0]('SUBSCRIBED');
    expect(catchUp).toHaveBeenCalledTimes(2);
  });
});
