import { describe, expect, it } from 'vitest';
import { kuwaitInput, kuwaitSchedule } from './announcementSchedule';
describe('fixed Kuwait admin scheduling', () => {
  it('maps Kuwait wall time to UTC across year boundaries', () => {
    expect(kuwaitSchedule('2027-01-01T01:30')).toBe('2026-12-31T22:30:00.000Z');
    expect(kuwaitInput(new Date('2026-12-31T22:30:00Z'))).toBe(
      '2027-01-01T01:30',
    );
  });
  it('rejects malformed or impossible dates without browser normalization', () => {
    for (
      const value of [
        '',
        '2027-02-30T12:00',
        '2027-01-01T25:00',
        '2027-01-01T12:00Z',
      ]
    ) expect(() => kuwaitSchedule(value)).toThrow('INVALID_SCHEDULE');
  });
});
