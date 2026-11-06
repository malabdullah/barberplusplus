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
