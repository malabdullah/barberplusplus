import ExcelJS from 'exceljs';
import { financeMetrics } from './financeFormatting';
import { localizedReportName } from './reportFormatting';
export function createFinanceWorkbook(report, labels, language) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Barber++'; workbook.created = new Date(report.createdAt);
  const sheet = (name, headings, widths) => {
    const s = workbook.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1, rightToLeft: language.startsWith('ar') }] });
    s.columns = widths.map(width => ({ width })); s.addRow(headings);
    s.getRow(1).font = { bold: true, color: { argb: 'FF141414' } };
    s.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A853' } };
    s.getRow(1).height = 26; return s;
  };
  const add = (s, values, money = [], dates = []) => {
    const row = s.addRow(values);
    values.forEach((value, i) => {
      if (typeof value === 'string') row.getCell(i + 1).numFmt = '@';
      if (money.includes(i)) row.getCell(i + 1).numFmt = '#,##0.000 "KWD"';
      if (dates.includes(i)) row.getCell(i + 1).numFmt = 'yyyy-mm-dd hh:mm';
    });
  };
  const e = labels.export;
  const summary = sheet(e.summary, [e.metric, e.value], [40, 55]);
  add(summary, [e.period, `${report.from} – ${report.to}`]);
  add(summary, [e.generated, new Date(new Date(report.createdAt).getTime() + 10800000)], [], [1]);
  for (const key of [...financeMetrics, 'dueFils', 'creditFils', 'payableFils']) add(summary, [labels.metrics[key], Number(report.summary[key]) / 1000], [1]);
  const shops = sheet(e.shops, [e.shop, ...['salesFils', 'expenseFils', 'operatingFils', 'cashFlowFils'].map(key => labels.metrics[key])], [38, 24, 24, 24, 24]);
  for (const row of report.shops) add(shops, [localizedReportName(row, language), ...['salesFils', 'expenseFils', 'operatingFils', 'cashFlowFils'].map(key => Number(row[key]) / 1000)], [1, 2, 3, 4]);
  const entries = sheet(e.entries, [e.shop, e.date, e.kind, e.reference, e.amount, e.cash, e.due, e.credit, e.payable, e.category], [36, 22, 28, 40, 24, 24, 24, 24, 24, 24]);
  const definitions = sheet(e.definitions, [e.metric, e.value], [36, 110]);
  add(definitions, [e.summary, labels.definition]); add(definitions, [labels.currentBalances, labels.balanceDefinition]); add(definitions, [e.id, report.id]);
  definitions.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  return {
    addRows(rows) { for (const row of rows) add(entries, [language.startsWith('ar') && row.shopNameAr || row.shopName, new Date(`${row.date}T00:00:00Z`), labels.kinds[row.kind], row.reference, ...['amountFils', 'cashFils', 'dueFils', 'creditFils', 'payableFils'].map(key => Number(row[key]) / 1000), labels.categories[row.category] || row.category], [4, 5, 6, 7, 8], [1]); },
    async finish() {
      for (const s of [shops, entries]) s.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, s.rowCount), column: s.columnCount } };
      return workbook.xlsx.writeBuffer();
    },
  };
}
