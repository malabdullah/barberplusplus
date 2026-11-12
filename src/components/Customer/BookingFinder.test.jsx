import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../../i18n/locales/en.json';
import BookingFinder from './BookingFinder';
import { customerBookingService as service } from '../../services/customerBooking.service';
import { getKuwaitDate } from '../../utils/customerBooking';
import { saveBookingDraft, readBookingDraft, rememberBookingReturn, readBookingReturnDraft, saveBookingReceipt, readBookingReceipt } from '../../utils/customerBookingDraft';
vi.mock('../../context/CustomerAuthContext', () => ({ useCustomerAuth: () => ({customer:null,loading:false}) }));
vi.mock('../../context/CustomerFavouritesContext', () => ({ useCustomerFavourites: () => ({items:[],loading:false}) }));
vi.mock('../../services/customerBooking.service', () => ({customerBookingService:{filters:vi.fn(),search:vi.fn(),selection:vi.fn()}}));
vi.mock('./FavouriteButton', () => ({default:()=>null}));
vi.mock('./FavouriteFeedback', () => ({default:()=>null}));
let props;
function Checkout(p) { props=p; return <><p>Checkout: {p.initialDraft.barberId}</p><button onClick={p.onClearSelection}>Clear selection</button></>; }
async function open(entries = ['/book']) {
  const i18n=i18next.createInstance(); await i18n.init({lng:'en',resources:{en:{translation:en}}});
  render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={entries}><BookingFinder checkout={Checkout}/></MemoryRouter></I18nextProvider>);
}
beforeEach(()=>{
  vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); localStorage.clear();sessionStorage.clear();props=null;
  service.filters.mockResolvedValue({cities:[{city:'Sharq'}]});
  service.search.mockResolvedValue({items:[{id:'barber',name:'Omar',city:'Sharq',shop_name:'Seafront'}],kind:'barber',nextCursor:null});
  service.selection.mockResolvedValue({branches:[{id:'shop',city:'Sharq'}],barbers:[{id:'barber'}],services:[],maxDuration:60});
});
afterEach(cleanup);
it('collects date and start range before displaying cities and carries the range into checkout',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:/Choose a time/}));
 expect(screen.queryByLabelText('City')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'10:00'}});fireEvent.change(screen.getByLabelText('To'),{target:{value:'11:00'}});
 fireEvent.click(screen.getByRole('button',{name:'Choose city'}));
 fireEvent.focus(screen.getByLabelText('City'));fireEvent.click(await screen.findByRole('option',{name:'Sharq',exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:/Omar/}));
 await screen.findByText('Checkout: barber');expect(props.initialDraft).toMatchObject({bookingMode:'time',city:'Sharq',date:getKuwaitDate(),rangeStart:'10:00',rangeEnd:'11:00',barberId:'barber',panel:'services'});
 expect(service.search).toHaveBeenCalledWith(expect.objectContaining({mode:'time',city:'Sharq',rangeStart:'10:00',rangeEnd:'11:00'}));
});
it('searches barbers without requiring city and loads only the selected provider',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:/Choose a barber/}));
 fireEvent.click(await screen.findByRole('button',{name:/Omar/}));await screen.findByText('Checkout: barber');
 expect(service.search).toHaveBeenCalledWith(expect.objectContaining({mode:'barber',city:''}));expect(props.scopedCatalog.barbers).toHaveLength(1);
});
it('restores a partial time-first draft through the sign-in handoff without restarting at shop search',async()=>{
 saveBookingDraft({city:'Sharq',branchId:'',barberId:'',serviceIds:[],date:getKuwaitDate(),time:'',step:0,bookingMode:'time',rangeStart:'12:00',rangeEnd:'14:00',finderStage:'results'});rememberBookingReturn();
 await open();await screen.findByRole('button',{name:/Omar/});
 expect(service.search).toHaveBeenCalledWith(expect.objectContaining({mode:'time',rangeStart:'12:00',rangeEnd:'14:00'}));
 expect(readBookingDraft().rangeEnd).toBe('14:00');
});
it('blocks reversed ranges and preserves the chosen date before a city exists',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:/Choose a time/}));
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'18:00'}});fireEvent.change(screen.getByLabelText('To'),{target:{value:'09:00'}});
 expect(screen.getByRole('button',{name:'Choose city'})).toBeDisabled();
 await waitFor(()=>expect(readBookingDraft()).toMatchObject({bookingMode:'time',rangeStart:'18:00',rangeEnd:'09:00',city:''}));
});

it('clears restored booking choices, sign-in return snapshot and cached receipt and stays reset after reload',async()=>{
 saveBookingDraft({city:'Sharq',branchId:'shop',barberId:'barber',serviceIds:[],date:getKuwaitDate(),time:'10:00',step:1,bookingMode:'time',rangeStart:'09:00',rangeEnd:'11:00',details:{name:'Guest',phone:'50000099',countryCode:'+965',notes:'Discard this note'}});
 rememberBookingReturn();saveBookingReceipt({id:'old',reference:'OLD',date:getKuwaitDate(),time:'10:00',duration:30,price:3,services:[]});
 await open();await screen.findByText('Checkout: barber');fireEvent.click(screen.getByRole('button',{name:'Clear selection',exact:true}));
 expect(await screen.findByRole('heading',{name:'How would you like to book?'})).toBeVisible();
 expect(readBookingDraft()).toBeNull();expect(readBookingReturnDraft()).toBeNull();expect(readBookingReceipt()).toBeNull();
 cleanup();await open();expect(screen.getByRole('heading',{name:'How would you like to book?'})).toBeVisible();expect(screen.queryByText('Checkout: barber')).not.toBeInTheDocument();
});
it('does not restore a selection when an earlier provider request finishes after clearing',async()=>{
 let finish;service.selection.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await open();fireEvent.click(screen.getByRole('button',{name:/Choose a barber/}));fireEvent.click(await screen.findByRole('button',{name:/Omar/}));
 fireEvent.click(screen.getByRole('button',{name:'Clear selection',exact:true}));
 await act(async()=>finish({branches:[{id:'shop',city:'Sharq'}],barbers:[{id:'barber'}],services:[]}));
 expect(screen.getByRole('heading',{name:'How would you like to book?'})).toBeVisible();expect(readBookingDraft()).toBeNull();expect(screen.queryByText('Checkout: barber')).not.toBeInTheDocument();
});

for (const mode of ['time', 'barber', 'shop']) {
 it('opens the landing '+mode+' entry directly without restoring a different provider', async()=>{
  saveBookingDraft({city:'Sharq',branchId:'old-shop',barberId:'old-barber',serviceIds:['old-service'],date:getKuwaitDate(),time:'10:00',step:1,bookingMode:'shop'});
  await open([{pathname:'/book',state:{bookingEntryMode:mode}}]);
  if(mode==='time') { expect(screen.getByLabelText('From')).toBeVisible(); expect(screen.queryByLabelText('City')).not.toBeInTheDocument(); }
  if(mode==='barber') await screen.findByLabelText('Search barbers');
  if(mode==='shop') expect(screen.getByLabelText('City')).toBeVisible();
  await waitFor(()=>expect(readBookingDraft()).toMatchObject({bookingMode:mode,barberId:'',branchId:'',serviceIds:[],city:'Sharq'}));
 });
}
