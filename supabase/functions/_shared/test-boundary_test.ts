import { createTestBoundary } from './test-boundary.ts';

const config = {environment:'cloud-test',appUrl:'https://test.example.com',publicUrl:'https://abcdefghijklmnopqrst.supabase.co',cloudTestProjectRef:'abcdefghijklmnopqrst',cloudAccessKey:'a'.repeat(48)};
const assert = (condition: boolean) => { if (!condition) throw new Error('Boundary assertion failed'); };
Deno.test('Cloud Test requires the selected project and a gateway secret', async () => {
  const boundary = createTestBoundary(config);
  assert(boundary.enabled);
  assert(!await boundary.allows(new Request(config.publicUrl)));
  assert(await boundary.allows(new Request(config.publicUrl,{headers:{'x-cloud-test-key':config.cloudAccessKey,origin:config.appUrl}})));
  assert(!await boundary.allows(new Request(config.publicUrl,{headers:{'x-cloud-test-key':config.cloudAccessKey,origin:'https://other.example.com'}})));
  assert(!createTestBoundary({...config,publicUrl:'https://other.supabase.co'}).enabled);
  assert(!createTestBoundary({...config,cloudAccessKey:''}).enabled);
  assert(!createTestBoundary({...config,environment:'production'}).enabled);
});
Deno.test('local Test keeps loopback aliases and rejects cloud origins', async () => {
  const boundary = createTestBoundary({environment:'test',appUrl:'http://localhost:5173',publicUrl:'http://127.0.0.1:55321'});
  assert(await boundary.allows(new Request('http://localhost',{headers:{origin:'http://127.0.0.1:5173'}})));
  assert(!await boundary.allows(new Request('http://localhost',{headers:{origin:config.appUrl}})));
  assert(!createTestBoundary({environment:'test',appUrl:'http://localhost:5173',publicUrl:config.publicUrl}).enabled);
});
