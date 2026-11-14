import { financesService } from './finances.service';
export async function exportFinance(report, labels, language, signal) {
  const worker = new Worker(new URL('../workers/financeExport.worker.js', import.meta.url), { type: 'module' });
  const send = (action, data) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('FINANCE_EXPORT_FAILED')); }, 120000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { cleanup(); reject(new Error('FINANCE_EXPORT_FAILED')); };
    worker.onmessage = event => { cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data); };
    worker.postMessage({ action, data });
  });
  try {
    await financesService.get(report.id);
    await send('start', { report, labels, language });
    let after = 0;
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const page = await financesService.rows(report.id, after);
      const batch = page.rows.slice(0, 500); await send('rows', batch);
      if (page.rows.length <= 500) break;
      after = batch.at(-1).ordinal;
    }
    const result = await send('finish');
    await financesService.get(report.id);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return new Blob([result.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  } finally { worker.terminate(); }
}
