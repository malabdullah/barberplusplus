import { customerIdentity } from './customer-session.ts';

const id = 'dc110000-0000-4000-8000-000000000001';
const token = 'header.' + btoa(JSON.stringify({ session_id: id })) + '.signature';

for (const result of [
  { data: true, error: null, allowed: true },
  { data: false, error: null, allowed: false },
  { data: null, error: { message: 'unavailable' }, allowed: false },
]) {
  Deno.test('customer token requires live session: ' + String(result.allowed), async () => {
    const identity = await customerIdentity({
      auth: { getUser: async () => ({ data: { user: { id, app_metadata: { role: 'customer' } } }, error: null }) },
      rpc: (name, params) => {
        if (name !== 'customer_session_is_live' || params.p_user !== id || params.p_session !== id) throw Error('Unexpected session lookup');
        return Promise.resolve(result);
      },
    }, token);
    if (Boolean(identity) !== result.allowed) throw Error('Unexpected identity result');
  });
}
