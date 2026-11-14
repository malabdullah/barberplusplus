import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createFinanceWorkbook } from './financeWorkbook';
import { parseFinanceAmount } from './financeFormatting';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
describe('financial amounts and exports', () => {
  it('parses decimal KWD without float rounding or accepting extra precision', () => {
    for (const [input, expected] of [['0.001', '1'], ['3.1', '3100'], ['٣٫١٢٥', '3125'], ['۱۲.۰۰۱', '12001'], ['10', '10000'], ['1000000', '1000000000']]) expect(parseFinanceAmount(input)).toBe(expected);
    for (const input of ['', '0', '-3', '3.0001', '1e3', 'Infinity', 'NaN', '1,000', '1000000.001', '=3+1']) expect(parseFinanceAmount(input)).toBeNull();
  });
  for (const [language, labels] of [['en', en.finance], ['ar', ar.finance]]) it(`exports typed, literal and complete ${language} financial snapshot`, async () => {
    const summary = { salesFils: '100000', expenseFils: '30000', operatingFils: '70000', netReceiptsFils: '60000', expensePaidFils: '10000', cashFlowFils: '50000', dueFils: '40000', creditFils: '0', payableFils: '20000' };
    const report = { id: 'snapshot', from: '2026-11-01', to: '2026-11-14', createdAt: '2026-11-14T20:30:00Z', summary, shops: [{ id: 's', name: '=HYPERLINK("https://example.test","literal")', nameAr: 'صالون', ...summary }] };
    const builder = createFinanceWorkbook(report, labels, language);
    builder.addRows(Array.from({ length: 503 }, (_, i) => ({ shopName: '=1+1', shopNameAr: 'صالون', date: '2026-11-14', kind: 'receipt', reference: `=${i}`, amountFils: '60000', cashFils: '60000', dueFils: '0', creditFils: '0', payableFils: '0', category: 'booking' })));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await builder.finish());
    expect(book.worksheets.length).toBe(4);
    const entries = book.worksheets[2];
    expect(entries.rowCount).toBe(504);
    expect(entries.getCell('E2').value).toBe(60);
    expect(entries.getCell('D2').type).toBe(ExcelJS.ValueType.String);
    expect(entries.getCell('B2').value).toEqual(new Date('2026-11-14T00:00:00Z'));
    expect(entries.views[0].rightToLeft).toBe(language === 'ar');
    expect(book.worksheets[0].getCell('B4').value).toBe(100);
    expect(book.worksheets[1].getCell('E2').value).toBe(50);
    expect(entries.getRow(1).values.join(' ')).not.toMatch(/phone|email/i);
  });
});
