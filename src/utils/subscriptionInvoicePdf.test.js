import { beforeEach, expect, it, vi } from 'vitest';
import en from '../i18n/locales/en.json';
const { doc } = vi.hoisted(() => ({ doc: Object.fromEntries([
  'addFileToVFS', 'addFont', 'setProperties', 'setFont', 'setFontSize',
  'setTextColor', 'text', 'setFillColor', 'roundedRect', 'setDrawColor',
  'setLineWidth', 'line', 'rect', 'addImage', 'link',
].map(name => [name, vi.fn()])) }));
vi.mock('jspdf', () => ({ jsPDF: class { constructor() { return doc; } } }));
import { createSubscriptionInvoice } from './subscriptionInvoicePdf';
const invoice = { id: 'invoice-1', state: 'paid', kind: 'subscription', currency: 'KWD', subtotal_fils: 30000, discount_fils: 15000, total_fils: 15000, created_at: '2026-11-26T09:00:00Z', period_starts_at: '2026-11-26T00:00:00Z', period_ends_at: '2026-12-26T00:00:00Z' };
const details = { invoice, businessName: 'Shop One', language: 'en', labels: en.subscriptionInvoice };
beforeEach(() => {
  vi.clearAllMocks();
  doc.splitTextToSize = value => [value];
  doc.getTextWidth = () => 40;
});
const texts = () => doc.text.mock.calls.map(([value]) => value);
it('creates a production invoice without sandbox claims and uses stored totals', () => {
  createSubscriptionInvoice(details, 'font', 'logo');
  expect(texts()).toEqual(expect.arrayContaining(['Shop One', 'KWD 30.000', '-KWD 15.000', 'KWD 15.000', en.subscriptionInvoice.issuedNote]));
  expect(texts()).not.toContain(en.subscriptionInvoice.test);
  expect(texts()).not.toContain(en.subscriptionInvoice.testNote);
  expect(doc.addImage).toHaveBeenCalledWith('logo', 'PNG', expect.any(Number), 22, expect.any(Number), expect.any(Number));
});
it('clearly marks Test invoices and keeps the capacity line item', () => {
  createSubscriptionInvoice({ ...details, isTest: true, invoice: { ...invoice, kind: 'capacity' } }, 'font', 'logo');
  expect(texts()).toEqual(expect.arrayContaining([en.subscriptionInvoice.test, en.subscriptionInvoice.testNote, en.subscriptionInvoice.capacityLineItem]));
  expect(texts()).not.toContain(en.subscriptionInvoice.issuedNote);
});
