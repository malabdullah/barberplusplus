import { jsPDF } from 'jspdf';

const fontName = 'Amiri-Regular.ttf';
const fontUrl = new URL('../assets/fonts/Amiri-Regular.ttf', import.meta.url);
const containsRtl = /[\u0590-\u08ff]/u;

export function createSubscriptionInvoice({ invoice, businessName, language, labels }, font) {
  const doc = new jsPDF({ compress: true, putOnlyUsedFonts: true });
  const rtl = language === 'ar';
  const start = rtl ? 188 : 22;
  const end = rtl ? 22 : 188;
  const startAlign = rtl ? 'right' : 'left';
  const endAlign = rtl ? 'left' : 'right';
  const ink = '#1d2024';
  const muted = '#565d65';
  const accent = '#806023';
  const dates = new Intl.DateTimeFormat(rtl ? 'ar-KW-u-ca-gregory' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuwait',
  });
  const money = fils => `${invoice.currency} ${(Number(fils) / 1000).toFixed(3)}`;

  doc.addFileToVFS(fontName, font);
  doc.addFont(fontName, 'Amiri', 'normal');
  doc.setProperties({ title: 'Barber++ subscription invoice', author: 'Barber++' });

  function text(value, x, y, { align = startAlign, size = 11, bold = false, color = ink } = {}) {
    const unicode = /[^\u0020-\u007e]/u.test(value);
    doc.setFont(unicode ? 'Amiri' : 'helvetica', bold && !unicode ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color);
    doc.text(value, x, y, { align, isInputVisual: false, isInputRtl: containsRtl.test(value),
      isOutputVisual: true, isOutputRtl: false });
  }

  function rule(y) {
    doc.setDrawColor('#e5dfd3');
    doc.line(22, y, 188, y);
  }

  text('Barber++', start, 27, { size: 21, bold: true });
  text(labels.test, end, 27, { align: endAlign, size: 11, bold: true, color: accent });
  text(labels.title, start, 46, { size: 20, bold: true });
  rule(54);

  const fields = [
    [labels.reference, invoice.id],
    [labels.issuedOn, dates.format(new Date(invoice.created_at))],
    [labels.periodStart, dates.format(new Date(invoice.period_starts_at))],
    [labels.periodEnd, dates.format(new Date(invoice.period_ends_at))],
    [labels.status, labels[invoice.state]],
  ];
  let y = 67;
  for (const [label, value] of fields) {
    text(label, start, y, { color: muted });
    text(value, end, y, { align: endAlign });
    y += 9;
  }

  text(labels.billedTo, start, y + 2, { color: muted });
  const name = businessName.trim().replace(/\s+/gu, ' ');
  doc.setFont('Amiri', 'normal');
  doc.setFontSize(13);
  for (const line of doc.splitTextToSize(name, 166)) {
    y += 8;
    text(line, start, y + 2, { size: 13 });
  }
  y += 13;
  rule(y);

  text(labels.subtotal, start, y + 12, { color: muted });
  text(money(invoice.subtotal_fils), end, y + 12, { align: endAlign });
  text(labels.discount, start, y + 22, { color: muted });
  text(money(invoice.discount_fils), end, y + 22, { align: endAlign });
  y += 30;
  doc.setFillColor('#f7f2e8');
  doc.roundedRect(22, y, 166, 18, 2, 2, 'F');
  text(labels.total, rtl ? 182 : 28, y + 12, { size: 13, bold: true });
  text(money(invoice.total_fils), rtl ? 28 : 182, y + 12, { align: endAlign, size: 15, bold: true });

  text(labels.testNote, start, y + 30, { size: 10, color: muted });
  return doc;
}

export async function downloadSubscriptionInvoice(details) {
  const response = await fetch(fontUrl);
  if (!response.ok) throw new Error('Invoice font is unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  }
  const doc = createSubscriptionInvoice(details, btoa(binary));
  doc.save(`BarberPlusPlus-Invoice-${details.invoice.id}.pdf`);
}
