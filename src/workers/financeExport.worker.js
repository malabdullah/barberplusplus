import { createFinanceWorkbook } from '../utils/financeWorkbook';
let workbook;
self.onmessage = async event => {
  try {
    const { action, data } = event.data;
    if (action === 'start') workbook = createFinanceWorkbook(data.report, data.labels, data.language);
    if (action === 'rows') workbook.addRows(data);
    if (action === 'finish') { const bytes = new Uint8Array(await workbook.finish()); self.postMessage({ bytes }, [bytes.buffer]); return; }
    self.postMessage({ ok: true });
  } catch { self.postMessage({ error: 'FINANCE_EXPORT_FAILED' }); }
};
