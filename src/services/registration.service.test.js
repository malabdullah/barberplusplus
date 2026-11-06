import {beforeEach,expect,it,vi} from 'vitest';
const request=vi.hoisted(()=>vi.fn());
vi.mock('../lib/functionFetch',()=>({functionFetch:request}));
vi.mock('../lib/runtimeConfig',()=>({appConfig:{supabaseUrl:'https://backend.example',supabasePublishableKey:'public-test-key'}}));
import {registrationService} from './registration.service';
beforeEach(()=>request.mockReset());
it('uses only the receipt for a verification check, with no Auth credential in the browser request',async()=>{
 request.mockResolvedValue(new Response(JSON.stringify({verified:false}),{status:200}));
 expect(await registrationService.status('signed')).toEqual({verified:false});
 const [url,options]=request.mock.calls[0];expect(url).toBe('https://backend.example/functions/v1/customer-auth');expect(JSON.parse(options.body)).toEqual({action:'manager-registration-status',receipt:'signed'});expect(options.headers).not.toHaveProperty('Authorization');
});
it('preserves resend retry feedback from the server',async()=>{
 request.mockResolvedValue(new Response(JSON.stringify({error:'RATE_LIMITED',retryAfter:35}),{status:429}));
 await expect(registrationService.resend('signed')).rejects.toMatchObject({message:'RATE_LIMITED',retryAfter:35});
});
