import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createSettlementWorkbook } from './settlementWorkbook';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
const statement = { id: 's', shopName: '=HYPERLINK("https://example.test")', period: '2026-11-01', state: 'final', createdAt: '2026-11-20T12:00:00Z', cutoffAt: '2026-11-20T12:00:00Z', totalFils: '95000', currentFils: '76000', paidFils: '95000', reservedFils: '0' };
describe('settlement Excel', () => {
  for (const [language, labels] of [['en', en.settlements], ['ar', ar.settlements]]) it(`preserves original and adjusted values in ${language}, with literal untrusted text`, async () => {
    const builder = createSettlementWorkbook(statement, labels, language);
    builder.addRows([{ snapshot: { bookingId: 'booking', bookingDate: '2026-11-01', bookingTime: '10:00', sourceRef: '=1+1', amountFils: '100000', commissionFils: '5000', netFils: '95000' }, current: { netFils: '76000', paidFils: '95000', reservedFils: '0', remainingFils: '-19000' } }]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await builder.finish());
    const rows = book.worksheets[1];
    expect(book.worksheets[0].getCell('B3').type).toBe(ExcelJS.ValueType.String);
    expect(rows.getCell('C2').type).toBe(ExcelJS.ValueType.String);
    expect(rows.getCell('C2').value).toBe('=1+1');
    expect(rows.getCell('F2').value).toBe(95);
    expect(rows.getCell('G2').value).toBe(76);
    expect(rows.getCell('J2').value).toBe(-19);
    expect(rows.views[0].rightToLeft).toBe(language === 'ar');
    expect(rows.getRow(1).values.join(' ')).not.toMatch(/email|phone|customer/i);
  });
});
