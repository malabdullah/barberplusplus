import { createReportWorkbook } from '../utils/reportWorkbook';

let workbook;
self.onmessage = async event => {
  try {
    const { action, data } = event.data;
    if (action === 'start') workbook = createReportWorkbook(data.report, data.labels, data.language);
    else if (action === 'groups') workbook.addGroups(data);
    else if (action === 'rows') workbook.addRows(data);
    else if (action === 'finish') {
      const value = await workbook.finish();
      const bytes = new Uint8Array(value);
      self.postMessage({ done: true, bytes }, [bytes.buffer]);
      return;
    }
    self.postMessage({ ready: true });
  } catch {
    self.postMessage({ error: 'REPORT_EXPORT_FAILED' });
  }
};
