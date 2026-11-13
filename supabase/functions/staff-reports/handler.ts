type Data = Record<string, unknown>;
export type ReportDependencies = {
  appUrl: string;
  rpc: (token: string, action: string, data: Data) => Promise<Data>;
  waitUntil: (task: Promise<unknown>) => void;
};

export function createReportHandler(deps: ReportDependencies) {
  return async (req: Request) => {
    const headers = {
      'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': deps.appUrl,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
    };
    const reply = (status: number, data: Data) => Response.json(data, { status, headers });
    if (req.headers.get('origin') && req.headers.get('origin') !== deps.appUrl) return reply(403, { error: 'REPORT_FORBIDDEN' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { error: 'REPORT_INVALID_ACTION' });
    const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply(401, { error: 'REPORT_FORBIDDEN' });
    try {
      const reader = req.body?.getReader();
      if (!reader) return reply(400, { error: 'REPORT_INVALID_FILTER' });
      let text = ''; let size = 0;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32768) { await reader.cancel(); return reply(413, { error: 'REPORT_INVALID_FILTER' }); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      const filters = JSON.parse(text);
      if (!filters || Array.isArray(filters) || typeof filters !== 'object') return reply(400, { error: 'REPORT_INVALID_FILTER' });
      const data = Object.fromEntries(['type', 'personal', 'shopIds', 'preset', 'from', 'to'].filter(key => key in filters).map(key => [key, filters[key]]));
      // Forward the user's JWT; Postgres checks the live session and shop scope.
      const job = await deps.rpc(token, 'create', data);
      deps.waitUntil(deps.rpc(token, 'build', { id: job.id }).catch(async () => {
        try { await deps.rpc(token, 'fail', { id: job.id }); } catch { /* Polling identifies abandoned jobs. */ }
      }));
      return reply(202, job);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      const error = failure instanceof SyntaxError ? 'REPORT_INVALID_FILTER' : /^REPORT_[A-Z_]+$/.test(message) ? message : 'REPORT_FAILED';
      const status = error === 'REPORT_FORBIDDEN' ? 403 : error === 'REPORT_RATE_LIMIT' ? 429 : error === 'REPORT_FAILED' ? 503 : 400;
      return reply(status, { error });
    }
  };
}
