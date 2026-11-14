import { reportsService } from './reports.service';

export async function exportReport(report, labels, language, onProgress, signal) {
  const worker = new Worker(new URL('../workers/reportExport.worker.js', import.meta.url), { type: 'module' });
  const send = (action, data) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { cleanup(); reject(new Error('REPORT_EXPORT_FAILED')); }, 120000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    worker.onerror = () => { cleanup(); reject(new Error('REPORT_EXPORT_FAILED')); };
    worker.onmessage = event => { cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data); };
    worker.postMessage({ action, data });
  });
  try {
    await reportsService.get(report.id);
    await send('start', { report, labels, language });
    for (const kind of ['groups', 'rows']) {
      let after = 0; let loaded = 0;
      while (true) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const page = await reportsService[kind](report.id, { after, limit: 500 });
        const batch = page.rows.slice(0, 500);
        await send(kind, batch);
        loaded += batch.length;
        if (kind === 'rows') onProgress(loaded, report.total);
        if (page.rows.length <= 500) break;
        after = batch.at(-1).ordinal;
      }
    }
    const result = await send('finish');
    // Recheck live authorization immediately before offering the private file.
    await reportsService.get(report.id);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return new Blob([result.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  } finally { worker.terminate(); }
}
