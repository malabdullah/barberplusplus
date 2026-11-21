import { settlementRpc } from './settlements.service';

export async function exportSettlement(admin, id, labels, language, signal) {
  const worker = new Worker(new URL('../workers/settlementExport.worker.js', import.meta.url), { type: 'module' });
  const send = (action, data) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('SETTLEMENT_EXPORT_FAILED')); }, 120000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { cleanup(); reject(new Error('SETTLEMENT_EXPORT_FAILED')); };
    worker.onmessage = event => { cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data); };
    worker.postMessage({ action, data });
  });
  try {
    const statement = await settlementRpc(admin, 'statement', { id });
    await send('start', { statement, labels, language });
    let after = 0;
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const page = await settlementRpc(admin, 'statement-rows', { id, after });
      const batch = page.rows.slice(0, 500);
      await send('rows', batch);
      if (!page.hasMore) break;
      if (!batch.length || batch.at(-1).ordinal <= after) throw new Error('SETTLEMENT_EXPORT_FAILED');
      after = batch.at(-1).ordinal;
    }
    const result = await send('finish');
    await settlementRpc(admin, 'statement', { id });
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return new Blob([result.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  } finally { worker.terminate(); }
}
