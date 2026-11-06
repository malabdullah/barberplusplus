import { beforeEach, expect, it, vi } from 'vitest';
const signup=vi.hoisted(()=>vi.fn());
vi.mock('./registration.service',()=>({registrationService:{signup}}));
vi.mock('../lib/supabase',()=>({supabase:{auth:{}}}));
vi.mock('./customerAuth.service',()=>({customerAuthService:{}}));
import {authService} from './auth.service';
beforeEach(()=>{localStorage.clear();signup.mockReset();});
it('keeps a signed verification receipt instead of treating signup as authentication',async()=>{
 signup.mockResolvedValue({success:true,confirmationRequired:true,receipt:'signed-receipt',email:'signup@example.test',expiresAt:Date.now()+10000,resendAt:Date.now()+1000});
 const result=await authService.signup({name:'QA',email:' Signup@Example.test ',phone:'+965 59998741',password:'Synthetic12!'});
 expect(result.receipt).toBe('signed-receipt');expect(result).not.toHaveProperty('session');expect(signup).toHaveBeenCalledWith(expect.objectContaining({email:'signup@example.test'}));
});
it.each(['SIGNUP_EMAIL_EXISTS','PHONE_REGISTRATION_CONFLICT','INVALID_PHONE','RATE_LIMITED'])('preserves the safe %s error code',async code=>{
 signup.mockRejectedValue(new Error(code));expect(await authService.signup({name:'QA',email:code.toLowerCase()+'@example.test',phone:'+965 59998741',password:'Synthetic12!'})).toEqual({success:false,error:code});
});
it('does not expose unexpected backend messages',async()=>{
 signup.mockRejectedValue(new Error('PRIVATE_BACKEND_DETAILS'));expect((await authService.signup({name:'QA',email:'other@example.test',phone:'+965 59998741',password:'Synthetic12!'})).error).toBe('REGISTRATION_FAILED');
});
