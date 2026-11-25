import { afterEach, expect, it, vi } from 'vitest';
import { readShopInvitation, rememberShopInvitation, clearShopInvitation, hasShopInvitation } from './shopInvitation';
const invite = { id: '12345678-1234-4234-8234-123456789012', token: 'a'.repeat(64) };
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); window.history.replaceState(null, '', '/'); });
it('keeps the invitation in this tab across an OAuth return and clears it after acceptance', () => {
 window.history.replaceState(null, '', '/accept-invite?invitation=' + invite.id + '#token=' + invite.token);
 expect(readShopInvitation()).toEqual(invite); rememberShopInvitation(invite);
 window.history.replaceState(null, '', '/accept-invite?code=provider-code'); expect(hasShopInvitation()).toBe(true); expect(readShopInvitation()).toEqual(invite);
 clearShopInvitation(); expect(readShopInvitation()).toBe(null);
});
it('reports blocked tab storage so OAuth cannot lose the invitation silently',()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Storage disabled');});
 expect(rememberShopInvitation(invite)).toBe(false);
});
it('rejects malformed tokens and keeps legacy Auth invitation links on their original path', () => {
 window.history.replaceState(null, '', '/accept-invite?invitation=invalid#token=bad'); expect(readShopInvitation()).toBe(null);
 rememberShopInvitation(invite); expect(readShopInvitation()).toBe(null); window.history.replaceState(null, '', '/accept-invite#token_hash=old&type=invite'); expect(hasShopInvitation()).toBe(false);
});
