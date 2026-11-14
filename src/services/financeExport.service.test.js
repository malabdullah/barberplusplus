import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportFinance } from './financeExport.service';
import { financesService } from './finances.service';
vi.mock('./finances.service', () => ({ financesService: { get: vi.fn(), rows: vi.fn() } }));
const messages = [];
class FakeWorker {
  postMessage(message) { messages.push(message); queueMicrotask(() => this.onmessage({ data: message.action === 'finish' ? { bytes: new Uint8Array([1, 2, 3]) } : { ok: true } })); }
  terminate = vi.fn();
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks(); messages.length = 0; });
describe('financial export authorization and cursor pages', () => {
  it('exports every frozen page exactly once and checks access again before download', async () => {
    vi.stubGlobal('Worker', FakeWorker); financesService.get.mockResolvedValue({ id: 'r' });
    financesService.rows.mockImplementation(async (_, after) => ({ rows: Array.from({ length: after ? 3 : 501 }, (_, i) => ({ ordinal: after + i + 1 })) }));
    const blob = await exportFinance({ id: 'r' }, {}, 'en', new AbortController().signal);
    expect(blob.size).toBe(3); expect(financesService.get).toHaveBeenCalledTimes(2);
    expect(financesService.rows.mock.calls).toEqual([['r', 0], ['r', 500]]);
    expect(messages.filter(m => m.action === 'rows').flatMap(m => m.data).map(r => r.ordinal)).toEqual(Array.from({ length: 503 }, (_, i) => i + 1));
  });
  it('does not offer a file after shop access was revoked during export', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    financesService.get.mockResolvedValueOnce({ id: 'r' }).mockRejectedValueOnce(new Error('FINANCE_FORBIDDEN'));
    financesService.rows.mockResolvedValue({ rows: [] });
    await expect(exportFinance({ id: 'r' }, {}, 'en')).rejects.toThrow('FINANCE_FORBIDDEN');
  });
});
