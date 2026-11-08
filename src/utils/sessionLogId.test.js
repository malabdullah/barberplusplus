import { expect, it } from 'vitest';
import { getLogSessionId } from './sessionLogId';
const token = claims => 'header.' + btoa(JSON.stringify(claims)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') + '.signature';
it('records the real session UUID, never the encoded JWT payload that caused database rejects', () => {
 const id='10000000-0000-4000-8000-000000000001';const access=token({session_id:id,sub:'another-user',role:'authenticated'});expect(getLogSessionId(access)).toBe(id);expect(getLogSessionId(access)).not.toBe(access.split('.')[1].slice(0,36));
});
it.each([undefined,'bad','header.@@@@.signature',token({}),token({session_id:'not-a-uuid'}),token({jti:'10000000-0000-4000-8000-000000000001'})])('keeps absent or invalid correlation IDs out of UUID columns: %s',access=>{expect(getLogSessionId(access)).toBe(null);});
