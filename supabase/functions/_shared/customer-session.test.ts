import { customerIdentity } from './customer-session.ts';
 Deno.test('service identity requires the validated token factor assertion', async () => {
  const bearer = `header.${btoa(JSON.stringify({session_id:'df110000-0000-4000-8000-000000000001',aal:'aal1'}))}.sig`;
  const client = {
    auth:{getUser:()=>Promise.resolve({data:{user:{id:'staff',app_metadata:{role:'manager'}}},error:null})},
    rpc:(name: string, data: Record<string, unknown>) => {
      if (name === 'staff_token_factor_satisfied' && data.p_aal !== 'aal1') throw Error('Token assurance was lost');
      return Promise.resolve({data:name === 'customer_session_is_live',error:null});
    },
  };
  if (await customerIdentity(client,bearer)) throw Error('Unsatisfied token factor accepted');
});
const token = `header.${btoa(JSON.stringify({session_id:'df110000-0000-4000-8000-000000000001'}))}.sig`;
for (const role of ['customer','manager','barber','admin','agent','unknown']) {
  Deno.test(`personal identity accepts only enabled account roles: ${role}`, async () => {
    let checked=false;
    const client = {
      auth:{getUser:()=>Promise.resolve({data:{user:{id:'person',app_metadata:{role}}},error:null})},
      rpc:()=>{checked=true;return Promise.resolve({data:true,error:null});},
    };
    const identity=await customerIdentity(client,token);
    const allowed=['customer','manager','barber'].includes(role);
    if(Boolean(identity)!==allowed || checked!==allowed)throw Error('Role/session boundary failed');
  });
}
Deno.test('expired/revoked staff token is not accepted in customer mode', async () => {
  const client={auth:{getUser:()=>Promise.resolve({data:{user:{id:'staff',app_metadata:{role:'manager'}}},error:null})},rpc:()=>Promise.resolve({data:false,error:null})};
  if(await customerIdentity(client,token))throw Error('Ended session accepted');
});
