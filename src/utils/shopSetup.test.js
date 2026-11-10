import { expect, it } from 'vitest';
import { getShopSetup, setupReturn, shopSetupUrl } from './shopSetup';
const id='10000000-0000-4000-8000-000000000001';
const shop={id,name:'QA shop',managerId:'manager',governorateId:'gov',areaId:'city',openingHours:{monday:{open:'09:00',close:'18:00'}}};
const service={id:'service',branchId:id,name:'Haircut',duration:30,price:3,status:'active'};
const barber={id:'barber',userId:'user',branchId:id,name:'Barber',inviteStatus:'accepted',status:'active',services:['service'],availabilityApprovedAt:'2026-11-08',availability:{monday:{enabled:true,start:'09:00',end:'18:00'}}};
it('resumes the first unmet requirement from saved records and is ready only with a fully configured barber',()=>{
 expect(getShopSetup()).toMatchObject({completed:0,next:'shop',ready:false});
 expect(getShopSetup(shop)).toMatchObject({completed:1,next:'services'});
 expect(getShopSetup(shop,[service])).toMatchObject({completed:2,next:'team'});
 expect(getShopSetup(shop,[service],[{...barber,availabilityApprovedAt:null}])).toMatchObject({completed:3,next:'hours',ready:false});
 expect(getShopSetup(shop,[service],[barber])).toMatchObject({completed:4,next:'review',ready:true});
});
it('cannot combine services on one barber and approved hours on a different barber',()=>{
 expect(getShopSetup(shop,[service],[{...barber,availabilityApprovedAt:null},{...barber,id:'other',services:[]}]).ready).toBe(false);
});
it.each([
 {status:'inactive'}, {userId:null}, {inviteStatus:'pending'}, {services:['foreign']}, {availabilityApprovedAt:null}, {availability:{monday:{enabled:false,start:'09:00',end:'18:00'}}}, {availability:{tuesday:{enabled:true,start:'09:00',end:'18:00'}}}, {availability:{monday:{enabled:true,start:'18:00',end:'19:00'}}}
])('rejects incomplete, unaccepted or incompatible barber setup: %j',patch=>{
 expect(getShopSetup(shop,[service],[{...barber,...patch}]).ready).toBe(false);
});
it('ignores foreign and archived services; optional contact, logo and My Chair do not block setup',()=>{
 expect(getShopSetup(shop,[{...service,status:'inactive'}],[barber]).ready).toBe(false);
 expect(getShopSetup(shop,[{...service,branchId:'other'}],[barber]).ready).toBe(false);
 expect(getShopSetup(shop,[service],[{...barber,managerChair:true,inviteStatus:null}]).ready).toBe(true);
 expect(getShopSetup({...shop,openingHours:{}},[service],[barber]).ready).toBe(false);
});
it('only builds internal return links for the signed-in manager’s own shop',()=>{
 const search='?setup='+id+'&setupStep=hours&returnTo=https://evil.example';
 expect(setupReturn(search,[shop],'manager')).toEqual({id,path:shopSetupUrl(id,'hours')});
 expect(setupReturn(search,[shop],'other')).toBe(null);
 expect(setupReturn('?setup=bad',[shop],'manager')).toBe(null);
 expect(setupReturn('?setup='+id+'&setupStep=https://evil.example',[shop],'manager').path).toBe('/dashboard/setup?shop='+id);
});

it('requires enough overlapping time for an assigned service',()=>{
 expect(getShopSetup(shop,[{...service,duration:30}],[{...barber,availability:{monday:{enabled:true,start:'09:00',end:'09:15'}}}]).ready).toBe(false);
});

it('accepts an active manager-managed barber with services and approved hours without an account',()=>{
 expect(getShopSetup(shop,[service],[{...barber,userId:null,managerManaged:true,inviteStatus:'managed'}]).ready).toBe(true);
 expect(getShopSetup(shop,[service],[{...barber,userId:null,managerManaged:true,inviteStatus:'managed',availabilityApprovedAt:null}]).ready).toBe(false);
});
