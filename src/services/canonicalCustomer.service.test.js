import { beforeEach, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:db,default:db}));
import { agentService } from './agent.service';
beforeEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();});
it('saves shared contact details and staff notes atomically through the restricted RPC',async()=>{
 db.rpc.mockResolvedValue({data:{id:'customer',name:'Updated',phone:'59998402',staff_details:{notes:'Staff only',tags:['VIP']}},error:null});
 const result=await agentService.updateCustomer('customer',{name:'Updated',phone:'59998402',notes:'Staff only',tags:['VIP']});
 expect(db.rpc).toHaveBeenCalledWith('save_customer_profile',{p_id:'customer',p_data:{name:'Updated',phone:'59998402',notes:'Staff only',tags:['VIP']}});
 expect(db.from).not.toHaveBeenCalled();
 expect(result).toMatchObject({id:'customer',name:'Updated',notes:'Staff only',tags:['VIP']});
});
it('returns a rejected duplicate save to the form without reporting success',async()=>{
 db.rpc.mockResolvedValue({data:null,error:{code:'23505',message:'PHONE_IN_USE'}});
 await expect(agentService.updateCustomer('customer',{phone:'59998402'})).rejects.toThrow('PHONE_EXISTS');
});

it('creates staff bookings by the selected canonical ID without making another phone-based customer',async()=>{
 vi.spyOn(agentService,'getCustomerById').mockResolvedValue({id:'canonical',status:'active',phone:null});
 const lookup=vi.spyOn(agentService,'findOrCreateCustomer');
 const insert=vi.fn(()=>({select:()=>({single:async()=>({data:{id:'booking',customer_id:'canonical',price:5},error:null})})}));
 db.from.mockReturnValue({insert});
 const result=await agentService.createBooking({customerId:'canonical',customerName:'Customer',customerPhone:'',agentUserId:'agent'});
 expect(result.customerId).toBe('canonical');expect(lookup).not.toHaveBeenCalled();
 expect(insert).toHaveBeenCalledWith([expect.objectContaining({customer_id:'canonical'})]);
});
