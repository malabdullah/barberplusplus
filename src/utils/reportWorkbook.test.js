import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import { createReportWorkbook } from './reportWorkbook';

describe('real report Excel files', () => {
  for (const [language, locale] of [['en', en], ['ar', ar]]) it(`preserves snapshot values, dates and literal user text (${language})`, async () => {
    const labels = locale.reports.exportLabels;
    const summary = { salesFils: '12000', completed: 1, customers: 1, newCustomers: 1, returningCustomers: 0, completedMinutes: 45, upcomingMinutes: 0, needsStatus: 0, cancelled: 0, noShow: 0, pending: 0, confirmed: 0, shopRating: null, shopRatingCount: 0, barberRating: null, barberRatingCount: 0 };
    const report = { id: 'snapshot-id', from: '2026-01-01', to: '2026-01-31', previousFrom: '2025-12-01T21:00:00Z', previousUntil: '2025-12-31T21:00:00Z', createdAt: '2026-11-13T07:30:00Z', expiresAt: '2026-11-14T07:30:00Z', type: 'services', personal: false, result: { summary, previous: summary, grouping: 'services', shops: [{ name: 'Shop', nameAr: 'صالون' }] } };
    const writer = createReportWorkbook(report, labels, language);
    writer.addGroups([{ id: 'p', kind: 'package', name: 'Package', nameAr: 'باقة', completed: 1, salesFils: '10000' }, { id: 'a', kind: 'service', name: 'Wash', completed: 1, salesFils: '2000' }]);
    writer.addRows([{ id: 'booking', date: '2026-01-31', time: '23:30:00', duration: 45, shopName: 'Shop', barberName: 'Barber', customerName: '=HYPERLINK("https://example.test","text")', status: 'completed', salesFils: '12000', package: { name: 'Package', service_ids: ['included'] }, services: [{ id: 'included', name: 'Included' }, { id: 'extra', name: 'Wash' }] }]);
    const bytes = await writer.finish();
    const result = new ExcelJS.Workbook(); await result.xlsx.load(bytes);
    expect(result.worksheets).toHaveLength(4);
    const appointments = result.getWorksheet(labels.appointments);
    expect(appointments.getCell('D2').value).toBe('=HYPERLINK("https://example.test","text")');
    expect(appointments.getCell('D2').type).toBe(ExcelJS.ValueType.String);
    expect(appointments.getCell('I2').value).toBe(12);
    expect(appointments.getCell('I2').numFmt).toContain('0.000');
    expect(appointments.getCell('F2').value.toISOString()).toBe('2026-01-31T23:30:00.000Z');
    expect(appointments.getCell('E2').value).toBe('Package · Wash');
    expect(appointments.views[0].rightToLeft).toBe(language === 'ar');
    expect(appointments.autoFilter).toBeTruthy();
    expect(appointments.getColumn(11).width).toBe(20);
    expect(appointments.getRow(1).values.join(' ')).not.toMatch(/email|phone|هاتف|بريد/i);
    const breakdown = result.getWorksheet(labels.breakdown);
    expect(breakdown.getCell('D2').value + breakdown.getCell('D3').value).toBe(12);
  });
});
