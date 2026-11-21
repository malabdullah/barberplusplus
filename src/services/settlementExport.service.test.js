import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportSettlement } from './settlementExport.service';
import { settlementRpc } from './settlements.service';
vi.mock('./settlements.service', () => ({ settlementRpc: vi.fn() }));
const messages = []; let worker;
class FakeWorker {
  constructor() { worker = this; }
  postMessage(message) { messages.push(message); queueMicrotask(() => this.onmessage({ data: message.action === 'finish' ? { bytes: new Uint8Array([1, 2]) } : { ok: true } })); }
  terminate = vi.fn();
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); messages.length = 0; });
describe('settlement export access and cursor', () => {
  it('streams all pages and reauthorizes immediately before releasing the file', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    settlementRpc.mockImplementation(async (admin, action, data) => action === 'statement' ? { id: 's' } : { hasMore: !data.after, rows: Array.from({ length: data.after ? 2 : 501 }, (_, i) => ({ ordinal: data.after + i + 1 })) });
    expect((await exportSettlement(false, 's', {}, 'en')).size).toBe(2);
    expect(settlementRpc.mock.calls.map(c => c[1])).toEqual(['statement', 'statement-rows', 'statement-rows', 'statement']);
    expect(messages.filter(m => m.action === 'rows').flatMap(m => m.data)).toHaveLength(502);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('withholds a generated file when a manager loses shop access', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    settlementRpc.mockResolvedValueOnce({ id: 's' }).mockResolvedValueOnce({ rows: [], hasMore: false }).mockRejectedValueOnce(new Error('SETTLEMENT_FORBIDDEN'));
    await expect(exportSettlement(false, 's', {}, 'en')).rejects.toThrow('SETTLEMENT_FORBIDDEN');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('aborts without requesting data when the account changes', async () => {
    vi.stubGlobal('Worker', FakeWorker); const controller = new AbortController(); controller.abort();
    settlementRpc.mockResolvedValueOnce({ id: 's' });
    await expect(exportSettlement(false, 's', {}, 'en', controller.signal)).rejects.toThrow('Cancelled');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
