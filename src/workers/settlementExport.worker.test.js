import { afterEach, expect, it, vi } from 'vitest';
import en from '../i18n/locales/en.json';
import '../utils/settlementWorkbook';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('transfers the Excel ArrayBuffer rather than a non-transferable typed array', async () => {
  const worker = { postMessage: vi.fn() }; vi.stubGlobal('self', worker);
  await import('./settlementExport.worker');
  await worker.onmessage({ data: { action: 'start', data: { statement: { id: 's', shopName: 'QA', createdAt: '2026-11-20T12:00:00Z', totalFils: '0', currentFils: '0', paidFils: '0', reservedFils: '0' }, labels: en.settlements, language: 'en' } } });
  await worker.onmessage({ data: { action: 'finish' } });
  const [message, transfer] = worker.postMessage.mock.calls.at(-1);
  expect(message.error).toBeUndefined();
  expect(message.bytes).toBeInstanceOf(Uint8Array);
  expect(message.bytes.byteLength).toBeGreaterThan(1000);
  expect(transfer).toEqual([message.bytes.buffer]);
  expect(() => structuredClone(message, { transfer })).not.toThrow();
});
