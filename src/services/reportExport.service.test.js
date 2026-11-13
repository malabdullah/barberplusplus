import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./reports.service', () => ({ reportsService: { get: vi.fn(), rows: vi.fn(), groups: vi.fn() } }));
import { reportsService } from './reports.service';
import { exportReport } from './reportExport.service';
let worker;
class FakeWorker {
  constructor() { worker = this; this.terminate = vi.fn(); this.actions = []; }
  postMessage(message) { this.actions.push(message.action); queueMicrotask(() => this.onmessage({ data: message.action === 'finish' ? { bytes: new Uint8Array([1, 2]) } : {} })); }
}
beforeEach(() => { vi.stubGlobal('Worker', FakeWorker); reportsService.get.mockResolvedValue({ state: 'ready' }); reportsService.rows.mockResolvedValue({ rows: [] }); reportsService.groups.mockResolvedValue({ rows: [] }); });
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('report export privacy invalidation', () => {
  it('rejects a stale report before loading its rows', async () => {
    reportsService.get.mockResolvedValue({ state: 'failed', error: 'REPORT_SOURCE_DELETED' });
    await expect(exportReport({ id: 'r' }, {}, 'en', vi.fn())).rejects.toThrow('REPORT_SOURCE_DELETED');
    expect(reportsService.rows).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalled();
  });
  it('never offers a buffered file after its source was deleted', async () => {
    reportsService.get.mockResolvedValueOnce({ state: 'ready' }).mockResolvedValueOnce({ state: 'failed', error: 'REPORT_SOURCE_DELETED' });
    await expect(exportReport({ id: 'r' }, {}, 'en', vi.fn())).rejects.toThrow('REPORT_SOURCE_DELETED');
    expect(worker.actions).toContain('finish'); expect(worker.terminate).toHaveBeenCalled();
  });
  it('checks authorization again immediately before returning the file', async () => {
    reportsService.get.mockResolvedValueOnce({ state: 'ready' }).mockRejectedValueOnce(new Error('REPORT_FORBIDDEN'));
    await expect(exportReport({ id: 'r' }, {}, 'en', vi.fn())).rejects.toThrow('REPORT_FORBIDDEN');
  });
  it('allows a ready, authorized snapshot after both checks', async () => {
    const blob = await exportReport({ id: 'r' }, {}, 'ar', vi.fn()); expect(blob.size).toBe(2); expect(reportsService.get).toHaveBeenCalledTimes(2);
  });
});
