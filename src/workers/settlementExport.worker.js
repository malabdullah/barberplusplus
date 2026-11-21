import { createSettlementWorkbook } from '../utils/settlementWorkbook';
let workbook;
self.onmessage = async ({ data: { action, data } }) => {
  try {
    if (action === 'start') workbook = createSettlementWorkbook(data.statement, data.labels, data.language);
    else if (action === 'rows') workbook.addRows(data);
    else if (action === 'finish') {
      const bytes = new Uint8Array(await workbook.finish());
      self.postMessage({ bytes }, [bytes.buffer]); return;
    }
    self.postMessage({ ok: true });
  } catch { self.postMessage({ error: 'SETTLEMENT_EXPORT_FAILED' }); }
};
