import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ShopSetup from './ShopSetup';
const id='10000000-0000-4000-8000-000000000001';
const state=vi.hoisted(()=>({}));const api=vi.hoisted(()=>({get:vi.fn(),create:vi.fn(),update:vi.fn()}));
vi.mock('../context/AppContext',()=>({useApp:()=>state}));
vi.mock('../services/shopSetup.service',()=>({shopSetupService:{get:api.get}}));
vi.mock('../services/services.service',()=>({servicesService:{create:api.create,update:api.update}}));
vi.mock('../components/Forms/BranchForm',()=>({default:({onSubmit,isSubmitting})=><button disabled={isSubmitting} onClick={()=>onSubmit({name:'QA Shop'})}>Save shop</button>}));
vi.mock('../components/Invitations/PendingInvitations',()=>({default:()=>null}));
vi.mock('../components/Invitations/InviteBarberForm',()=>({default:()=>null}));
const shop={id,name:'QA Shop',managerId:'manager',governorateId:'gov',areaId:'area',openingHours:{monday:{open:'09:00',close:'18:00'}}};
let i18n;
beforeEach(async()=>{
 vi.clearAllMocks();Object.assign(state,{user:{id:'manager'},branches:[shop],selectedBranchId:id,setSelectedBranchId:vi.fn(),addBranch:vi.fn().mockResolvedValue(shop),updateBranch:vi.fn().mockResolvedValue(shop),reloadData:vi.fn(),addService:api.create,updateService:api.update});
 api.get.mockResolvedValue({shop,services:[],barbers:[]});api.create.mockResolvedValue({id:'service',branchId:id,name:'Haircut',duration:30,price:3,status:'active'});
 i18n=i18next.createInstance();await i18n.init({lng:'en',resources:{en:{translation:en}}});
});
afterEach(cleanup);
function mount(path='/dashboard/setup?shop='+id){return render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[path]}><Routes><Route path="/dashboard/setup" element={<ShopSetup/>}/><Route path="/dashboard" element={<h1>Workspace</h1>}/></Routes></MemoryRouter></I18nextProvider>);}
it('resumes from saved shop details at services, saves the service in the explicit shop and advances',async()=>{
 mount();await screen.findByLabelText(en.services.name);fireEvent.change(screen.getByLabelText(en.services.name),{target:{value:'Haircut'}});fireEvent.change(screen.getByLabelText(en.services.price+' (KWD)'),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'Add Service',exact:true}));await screen.findByText('Haircut');expect(api.create).toHaveBeenCalledWith({name:'Haircut',description:'',duration:30,price:3,branchId:id});
 fireEvent.click(screen.getByRole('button',{name:'Continue',exact:true}));expect(await screen.findByRole('button',{name:'Invite barber',exact:true})).toBeVisible();
});
it('does not mistake a failed load for a new shop or show completion',async()=>{
 api.get.mockRejectedValue(new Error('network'));mount();expect(await screen.findByRole('alert')).toHaveTextContent(en.shopSetup.loadFailed);expect(screen.queryByRole('button',{name:'Save shop'})).toBe(null);expect(screen.queryByText(en.shopSetup.ready)).toBe(null);
});
it('blocks a foreign-shop URL without making data requests',()=>{mount('/dashboard/setup?shop=10000000-0000-4000-8000-000000000002');expect(screen.getByRole('alert')).toHaveTextContent(en.shopSetup.notFound);expect(api.get).not.toHaveBeenCalled();});
it('keeps the wizard on shop creation failure and supports a successful retry',async()=>{
 state.branches=[];state.selectedBranchId=null;state.addBranch.mockRejectedValueOnce(new Error('save'));mount('/dashboard/setup?shop=new');fireEvent.click(screen.getByRole('button',{name:'Save shop'}));expect(await screen.findByRole('alert')).toHaveTextContent(en.shopSetup.saveFailed);
 state.addBranch.mockImplementation(async()=>{state.branches=[shop];return shop;});fireEvent.click(screen.getByRole('button',{name:'Save shop'}));await screen.findByLabelText(en.services.name);expect(state.addBranch).toHaveBeenCalledTimes(2);
});
