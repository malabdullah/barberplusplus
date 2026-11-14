import ExcelJS from 'exceljs';
import { averageFils, localizedReportName, serviceReportNames } from './reportFormatting';

export function createReportWorkbook(report, labels, language) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Barber++';
  workbook.created = new Date(report.createdAt);
  const rtl = language.startsWith('ar');
  function sheet(name, headings, widths) {
    const s = workbook.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1, rightToLeft: rtl }] });
    s.addRow(headings);
    s.columns = widths.map(width => ({ width }));
    s.getRow(1).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF141414' } };
    s.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A853' } };
    s.getRow(1).height = 26;
    return s;
  }
  function add(s, values, moneyCols = [], dateCols = []) {
    const row = s.addRow(values);
    row.font = { name: 'Arial', size: 11 };
    values.forEach((value, i) => {
      const cell = row.getCell(i + 1);
      // Literal string cells cannot become formulas or external hyperlinks.
      if (typeof value === 'string') cell.numFmt = '@';
      if (moneyCols.includes(i)) cell.numFmt = '#,##0.000 "KWD"';
      if (dateCols.includes(i)) cell.numFmt = 'yyyy-mm-dd hh:mm';
    });
  }
  const number = fils => fils === null || fils === undefined ? null : Number(fils) / 1000;
  const summary = sheet(labels.summary, [labels.metric, labels.value], [34, 48]);
  add(summary, [labels.period, `${report.from} – ${report.to}`]);
  add(summary, [labels.shops, report.result.shops.map(shop => localizedReportName(shop, language)).join(' · ')]);
  add(summary, [labels.generated, new Date(new Date(report.createdAt).getTime() + 10800000)], [], [1]);
  const current = report.result.summary;
  for (const key of ['salesFils', 'completed', 'customers', 'newCustomers', 'returningCustomers', 'completedMinutes', 'upcomingMinutes', 'needsStatus', 'cancelled', 'noShow', 'pending', 'confirmed', 'shopRating', 'shopRatingCount', 'barberRating', 'barberRatingCount']) {
    add(summary, [labels[key], key === 'salesFils' ? number(current[key]) : current[key]], key === 'salesFils' ? [1] : []);
  }
  add(summary, [labels.average, number(averageFils(current.salesFils, current.completed))], [1]);
  const prior = report.result.previous;
  add(summary, [labels.previousPeriod, `${report.previousFrom} – ${report.previousUntil}`]);
  add(summary, [labels.previousSales, number(prior.salesFils)], [1]);
  add(summary, [labels.previousCompleted, prior.completed]);
  add(summary, [labels.previousCustomers, prior.customers]);
  add(summary, [labels.previousAverage, number(averageFils(prior.salesFils, prior.completed))], [1]);
  const breakdown = sheet(labels.breakdown, [labels.name, labels.kind, labels.completed, labels.salesFils, labels.customers, labels.newCustomers, labels.returningCustomers, labels.completedMinutes, labels.shopRating, labels.shopRatingCount, labels.barberRating, labels.barberRatingCount], [34, 20, 18, 22, 18, 18, 20, 20, 18, 18, 18, 18]);
  const appointments = sheet(labels.appointments, [labels.reference, labels.shop, labels.barber, labels.customer, labels.services, labels.date, labels.status, labels.duration, labels.bookingPrice, labels.shopRating, labels.barberRating], [38, 30, 28, 28, 60, 23, 20, 18, 22, 20, 20]);
  const definitions = sheet(labels.definitions, [labels.metric, labels.definition], [32, 110]);
  for (const [key, value] of Object.entries(labels.rules)) add(definitions, [labels[key] || key, value]);
  add(definitions, [labels.timezone, 'Asia/Kuwait (UTC+3)']);
  add(definitions, [labels.reference, report.id]);
  add(definitions, [labels.scope, report.personal ? labels.personal : labels.managedShops]);
  add(definitions, [labels.type, labels.types[report.type]]);
  add(definitions, [labels.expires, report.expiresAt]);
  return {
    addGroups(groups) {
      groups.forEach(row => add(breakdown, [row.kind === 'unallocated' ? labels.unallocated : localizedReportName(row, language), labels.kinds[row.kind] || labels.types[report.result.grouping], row.completed, number(row.salesFils), row.customers ?? null, row.newCustomers ?? null, row.returningCustomers ?? null, row.minutes ?? null, row.shopRating ?? null, row.shopRatingCount ?? null, row.barberRating ?? null, row.barberRatingCount ?? null], [3]));
    },
    addRows(rows) {
      rows.forEach(row => add(appointments, [row.id, rtl && row.shopNameAr || row.shopName, rtl && row.barberNameAr || row.barberName, rtl && row.customerNameAr || row.customerName || '', serviceReportNames(row, language), new Date(`${row.date}T${row.time}Z`), labels.statuses[row.status] || row.status, row.duration, number(row.salesFils), row.shopRating ?? null, row.barberRating ?? null], [8], [5]));
    },
    async finish() {
      add(breakdown, [labels.reportTotal, '', current.completed, number(current.salesFils), current.customers, current.newCustomers, current.returningCustomers, current.completedMinutes, current.shopRating, current.shopRatingCount, current.barberRating, current.barberRatingCount], [3]);
      for (const s of [breakdown, appointments]) s.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, s.rowCount), column: s.columnCount } };
      definitions.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
      return workbook.xlsx.writeBuffer();
    },
  };
}
