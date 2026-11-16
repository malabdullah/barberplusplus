import { expect, it } from 'vitest';
import { nativeEmailReturn } from './nativeEmailReturn';
const appUrl='https://barber-test.alabdullah-cs.workers.dev';
const config={environment:'cloud-test',appUrl};
const id='af220000-0000-4000-8000-000000000003';
const input=`${appUrl}/customer/email-callback?client=ios&state=${id}&request_id=${id}#type=recovery&token_hash=${'a'.repeat(64)}`;
it('returns only an opaque native recovery handle, never an Auth credential',()=>{
 const output=new URL(nativeEmailReturn(input,config,id));
 expect(output.protocol).toBe('barberplusplus-test:'); expect(output.searchParams.get('delivery_token')).toBe(id);
 expect(output.searchParams.has('token_hash')).toBe(false); expect(output.searchParams.get('state')).toBe(id);
});
it('requires a validated server delivery handle and exact environment',()=>{
 expect(()=>nativeEmailReturn(input,config)).toThrow('NATIVE_DELIVERY_REQUIRED');
 expect(()=>nativeEmailReturn(input,{...config,environment:'production'},id)).toThrow('INVALID_CODE');
 expect(()=>nativeEmailReturn(input.replace(appUrl,'https://evil.test'),config,id)).toThrow('INVALID_CODE');
 expect(nativeEmailReturn(input.replace('client=ios','client=web'),config,id)).toBeNull();
});
it('Android signup and recovery return only a device-bound opaque handle on the separate Test host',()=>{
 for(const type of ['signup','recovery']){
  const input=`${appUrl}/customer/email-callback?client=android&request_id=${id}&state=${id}#type=${type}&token_hash=${'b'.repeat(64)}`;
  expect(()=>nativeEmailReturn(input,config)).toThrow('NATIVE_DELIVERY_REQUIRED');
  const url=new URL(nativeEmailReturn(input,config,id));expect(url.origin).toBe('https://barber-auth-test.alabdullah-cs.workers.dev');
  expect([...url.searchParams.keys()]).toEqual(['requestId','state','delivery']);expect(url.href).not.toContain('token_hash');
  expect(()=>nativeEmailReturn(input,{environment:'production',appUrl:'https://www.barberplusplus.com'},id)).toThrow('INVALID_CODE');
 }
});
it('Android rejects session fragments, duplicate bindings and arbitrary redirect fields',()=>{
 const valid=`${appUrl}/customer/email-callback?client=android&request_id=${id}&state=${id}#type=signup&token_hash=${'b'.repeat(64)}`;
 for(const input of [valid+'&access_token=private',valid.replace('#',`&state=${id}#`),valid.replace('#','&next=https://evil.test&redirect_to=https://evil.test#')])expect(()=>nativeEmailReturn(input,config,id)).toThrow('INVALID_CODE');
});
it('Android browser fallback cannot redirect back into a loop or adopt a session',()=>{
 expect(()=>nativeEmailReturn(`${appUrl}/customer/email-callback?client=android&native_fallback=1`,config)).toThrow('ANDROID_NATIVE_FALLBACK');
 expect(()=>nativeEmailReturn(`${appUrl}/customer/email-callback?client=android&native_fallback=1&state=${id}`,config)).toThrow('INVALID_CODE');
});
