import { jsPDF } from 'jspdf';

const fontName = 'Amiri-Regular.ttf';
const fontUrl = new URL('../assets/fonts/Amiri-Regular.ttf', import.meta.url);
const logoUrl = '/brand/barber-horizontal-light.svg';
const supportEmail = 'support@barberplusplus.com';
const containsRtl = /[\u0590-\u08ff]/u;

async function loadLogo() {
  const image = new Image();
  image.src = logoUrl;
  await image.decode();

  // The website wordmark has outlined paths. Rasterize the same artwork at
  // print resolution without adding another copy of the logo to the project.
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = Math.round(canvas.width * image.naturalHeight / image.naturalWidth);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function createSubscriptionInvoice({ invoice, businessName, language, labels }, font, logo) {
  const doc = new jsPDF({ compress: true, putOnlyUsedFonts: true });
  const rtl = language === 'ar';
  const left = 22;
  const width = 166;
  const startAlign = rtl ? 'right' : 'left';
  const endAlign = rtl ? 'left' : 'right';
  const x = offset => rtl ? left + width - offset : left + offset;
  const boxX = (offset, span) => rtl ? x(offset) - span : x(offset);
  const ink = '#1d2024';
  const muted = '#565d65';
  const gold = '#d4a853';
  const line = '#e7e1d6';
  const cream = '#f7f4ed';
  const dates = new Intl.DateTimeFormat(rtl ? 'ar-KW-u-ca-gregory' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuwait',
  });
  const date = value => dates.format(new Date(value));
  const money = fils => `${invoice.currency} ${(Number(fils) / 1000).toFixed(3)}`;

  doc.addFileToVFS(fontName, font);
  doc.addFont(fontName, 'Amiri', 'normal');
  doc.setProperties({ title: 'Barber++ subscription invoice', author: 'Barber++' });

  function fontFor(value, size, bold = false) {
    const unicode = /[^\u0020-\u007e]/u.test(value);
    doc.setFont(unicode ? 'Amiri' : 'helvetica', bold && !unicode ? 'bold' : 'normal');
    doc.setFontSize(size);
  }

  function text(value, offset, y, { align = startAlign, size = 11, bold = false, color = ink } = {}) {
    fontFor(value, size, bold);
    doc.setTextColor(color);
    doc.text(value, x(offset), y, { align, isInputVisual: false, isInputRtl: containsRtl.test(value),
      isOutputVisual: true, isOutputRtl: false });
  }

  function panel(offset, y, span, height, fill, radius = 2) {
    doc.setFillColor(fill);
    doc.roundedRect(boxX(offset, span), y, span, height, radius, radius, 'F');
  }

  function rule(y) {
    doc.setDrawColor(line);
    doc.setLineWidth(0.3);
    doc.line(left, y, left + width, y);
  }

  doc.setFillColor(gold);
  doc.rect(left, 15, width, 0.8, 'F');
  doc.addImage(logo, 'PNG', boxX(0, 57), 22, 57, 57 * 106 / 506.2794);
  panel(width - 37, 23, 37, 9, cream);
  text(labels.test, width - 18.5, 29, { align: 'center', size: 10, bold: true, color: '#76531a' });

  text(labels.title, 0, 52, { size: 25, bold: true });
  const paid = invoice.state === 'paid';
  panel(width - 27, 45, 27, 9, paid ? '#e9f3ed' : '#f3efea');
  text(labels[invoice.state], width - 13.5, 51, { align: 'center', size: 10, bold: true,
    color: paid ? '#286144' : '#655344' });

  text(labels.reference, 0, 64, { size: 9, color: muted });
  text(invoice.id, 0, 71, { size: 10 });
  text(labels.issuedOn, width, 64, { align: endAlign, size: 9, color: muted });
  text(date(invoice.created_at), width, 71, { align: endAlign, bold: true });

  const name = businessName.trim().replace(/\s+/gu, ' ');
  const detailsTop = 82;
  const gap = 6;
  const card = (width - gap) / 2;
  const periodOffset = card + gap;
  const padding = 6;
  fontFor(name, 14, true);
  const nameLines = doc.splitTextToSize(name, card - 2 * padding);
  const detailsHeight = Math.max(43, 22 + nameLines.length * 7);

  panel(0, detailsTop, card, detailsHeight, cream);
  panel(periodOffset, detailsTop, card, detailsHeight, cream);
  text(labels.billedTo, padding, detailsTop + 11, { size: 10, color: muted });
  nameLines.forEach((value, index) => text(value, padding, detailsTop + 21 + index * 7, { size: 14, bold: true }));

  text(labels.billingPeriod, periodOffset + padding, detailsTop + 11, { size: 10, bold: true });
  text(labels.periodStart, periodOffset + padding, detailsTop + 23, { size: 9, color: muted });
  text(date(invoice.period_starts_at), width - padding, detailsTop + 23, { align: endAlign, size: 10 });
  text(labels.periodEnd, periodOffset + padding, detailsTop + 34, { size: 9, color: muted });
  text(date(invoice.period_ends_at), width - padding, detailsTop + 34, { align: endAlign, size: 10 });

  const chargesTop = detailsTop + detailsHeight + 16;
  text(labels.description, 0, chargesTop, { size: 10, bold: true, color: muted });
  text(labels.amount, width, chargesTop, { align: endAlign, size: 10, bold: true, color: muted });
  rule(chargesTop + 5);
  text(invoice.kind === 'capacity' ? labels.capacityLineItem : labels.lineItem, 0, chargesTop + 16, { size: 13, bold: true });
  text(money(invoice.subtotal_fils), width, chargesTop + 16, { align: endAlign });
  let totalsTop = chargesTop + 27;
  if (Number(invoice.discount_fils) > 0) {
    text(labels.discount, 0, chargesTop + 27, { color: muted });
    text(`-${money(invoice.discount_fils)}`, width, chargesTop + 27, { align: endAlign });
    totalsTop += 11;
  }

  panel(0, totalsTop, width, 23, ink);
  text(labels.total, 7, totalsTop + 14, { size: 13, bold: true, color: '#ffffff' });
  text(money(invoice.total_fils), width - 7, totalsTop + 15, { align: endAlign, size: 19, bold: true, color: '#e6bd70' });

  const footer = Math.max(252, totalsTop + 37);
  rule(footer);
  text(labels.testNote, 0, footer + 10, { size: 10, color: muted });
  text(supportEmail, 0, footer + 19, { size: 10, color: '#76531a' });
  const emailWidth = doc.getTextWidth(supportEmail);
  doc.link(boxX(0, emailWidth), footer + 15, emailWidth, 5, { url: `mailto:${supportEmail}` });
  return doc;
}

export async function downloadSubscriptionInvoice(details) {
  const [response, logo] = await Promise.all([fetch(fontUrl), loadLogo()]);
  if (!response.ok) throw new Error('Invoice font is unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  }
  const doc = createSubscriptionInvoice(details, btoa(binary), logo);
  doc.save(`BarberPlusPlus-Invoice-${details.invoice.id}.pdf`);
}
