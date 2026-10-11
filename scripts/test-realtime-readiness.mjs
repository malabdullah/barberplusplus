// Protocol readiness for a newly seeded disposable stack. It does not replace
// private-channel authentication or tenant-denial acceptance checks.
export async function waitForTestWebsocket(anon, options = {}) {
  if (typeof anon !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(anon)) throw new Error('Invalid disposable browser key');
  const { request } = await import('node:http');
  const { randomBytes } = await import('node:crypto');
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const probe = options.probe || (() => new Promise(resolve => {
    const req = request(`http://api-gw:8000/realtime/v1/websocket?apikey=${anon}&vsn=1.0.0`, { headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } });
    req.on('upgrade', (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    req.on('response', response => { response.resume(); resolve(response.statusCode); });
    req.on('error', () => resolve('transport-error'));
    req.setTimeout(5000, () => { req.destroy(); resolve('timeout'); }); req.end();
  }));
  const deadline = now() + 120000;
  while (now() < deadline) {
    const status = await probe();
    if (status === 101) return;
    if ([400, 401, 403, 404].includes(status)) throw new Error('Disposable Realtime protocol denied');
    await sleep(1000);
  }
  throw new Error('Disposable Realtime protocol readiness timeout');
}
