import ExcelJS from 'exceljs';

export function createSettlementWorkbook(statement, labels, language) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Barber++';
  workbook.created = new Date(statement.createdAt);
  const sheet = (name, headings, widths) => {
    const page = workbook.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1, rightToLeft: language.startsWith('ar') }] });
    page.columns = widths.map(width => ({ width }));
    page.addRow(headings);
    page.getRow(1).font = { bold: true, color: { argb: 'FF141414' } };
    page.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A853' } };
    return page;
  };
  const add = (page, values, money = []) => {
    const row = page.addRow(values);
    values.forEach((value, i) => {
      // Explicit strings never become spreadsheet formulas or hyperlinks.
      row.getCell(i + 1).numFmt = money.includes(i) ? '#,##0.000 "KWD"' : typeof value === 'string' ? '@' : 'General';
    });
  };
  const summary = sheet(labels.statements, [labels.field, labels.value], [38, 65]);
  for (const key of ['id', 'shopName', 'period', 'state', 'cutoffAt']) add(summary, [labels[key] || key, statement[key]]);
  for (const key of ['totalFils', 'currentFils', 'paidFils', 'reservedFils']) add(summary, [labels[key], Number(statement[key]) / 1000], [1]);
  const rows = sheet(labels.receipts, [labels.bookingId, labels.date, labels.reference, labels.amountFils, labels.commissionFils, labels.totalFils, labels.currentFils, labels.paidFils, labels.reservedFils, labels.remainingFils], [40, 20, 38, 24, 24, 24, 24, 24, 24, 24]);
  return {
    addRows(batch) {
      for (const { snapshot, current } of batch) add(rows, [snapshot.bookingId, `${snapshot.bookingDate} ${snapshot.bookingTime}`, snapshot.sourceRef,
        ...[snapshot.amountFils, snapshot.commissionFils, snapshot.netFils, current.netFils, current.paidFils, current.reservedFils, current.remainingFils].map(v => Number(v) / 1000)], [3, 4, 5, 6, 7, 8, 9]);
    },
    finish() {
      rows.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.rowCount), column: rows.columnCount } };
      return workbook.xlsx.writeBuffer();
    },
  };
}
