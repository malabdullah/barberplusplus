import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import SharedBooking from './SharedBooking';
import { bookingShareService } from '../services/bookingShare.service';
vi.mock('../lib/runtimeConfig',()=>({appConfig:{environment:'cloud-test'}}));
vi.mock('../services/bookingShare.service',()=>({bookingShareService:{view:vi.fn()}}));
let i18n;
const booking={reference:'REFERENCE',shop:'Shop QA',barber:'Barber QA',shopId:'10000000-0000-4000-8000-000000000011',barberId:'30000000-0000-4000-8000-000000000112',date:'2026-11-17',time:'10:00',duration:30,price:5,status:'confirmed',services:[]};
beforeEach(async()=>{vi.resetAllMocks();i18n=i18next.createInstance();await i18n.init({lng:'en',resources:{en:{translation:en}}});bookingShareService.view.mockResolvedValue(booking);});
afterEach(()=>{cleanup();vi.useRealTimers();});
const mount=()=>render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/booking/share#'+'a'.repeat(64)]}><SharedBooking/></MemoryRouter></I18nextProvider>);
it('makes public shop and barber names link to the correct new booking routes',async()=>{
 mount();expect(await screen.findByRole('link',{name:'Shop QA'})).toHaveAttribute('href','https://barber-open-test.alabdullah-cs.workers.dev/book?shop='+booking.shopId);
 expect(screen.getByRole('link',{name:'Barber QA'})).toHaveAttribute('href','https://barber-open-test.alabdullah-cs.workers.dev/book?barber='+booking.barberId);
 expect(screen.queryByRole('link',{name:/REFERENCE/})).not.toBeInTheDocument();
});
it('refreshes only at an hour; focus and visibility changes never trigger another request',async()=>{
 vi.useFakeTimers();await act(async()=>{mount();});expect(bookingShareService.view).toHaveBeenCalledTimes(1);
 fireEvent(window,new Event('focus'));fireEvent(document,new Event('visibilitychange'));
 await act(async()=>{vi.advanceTimersByTime(3599999);});expect(bookingShareService.view).toHaveBeenCalledTimes(1);
 await act(async()=>{vi.advanceTimersByTime(1);});expect(bookingShareService.view).toHaveBeenCalledTimes(2);
 cleanup();await act(async()=>{vi.advanceTimersByTime(3600000);});expect(bookingShareService.view).toHaveBeenCalledTimes(2);
});
it('keeps older payloads readable without fabricating target identifiers',async()=>{
 bookingShareService.view.mockResolvedValue({...booking,shopId:undefined,barberId:undefined});mount();await screen.findByText('Shop QA');
 expect(screen.queryByRole('link',{name:'Shop QA'})).not.toBeInTheDocument();
});
