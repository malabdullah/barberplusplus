import {beforeEach,expect,it} from 'vitest';
import {rememberRegistration,pendingRegistration,forgetRegistration} from './pendingRegistration';
beforeEach(()=>sessionStorage.clear());
it('persists only a bounded verification receipt and never signup credentials',()=>{
 rememberRegistration({receipt:'signed-receipt',email:'qa@example.test',expiresAt:Date.now()+10000,resendAt:Date.now()+1000,password:'Secret12!',access_token:'secret-session'});
 const saved=pendingRegistration();expect(saved.email).toBe('qa@example.test');expect(saved.confirmationRequired).toBe(true);expect(saved).not.toHaveProperty('password');expect(saved).not.toHaveProperty('access_token');
 forgetRegistration();expect(pendingRegistration()).toBeNull();
});
it('discards expired and malformed pending verification state',()=>{
 rememberRegistration({receipt:'signed',email:'qa@example.test',expiresAt:Date.now()-1});expect(pendingRegistration()).toBeNull();
 sessionStorage.setItem('barber-pending-manager-registration','not-json');expect(pendingRegistration()).toBeNull();
});
