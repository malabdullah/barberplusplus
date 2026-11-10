import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import AddBarber from './AddBarber';
const state = vi.hoisted(() => ({ selectedBranch: { id: 'shop', name: 'QA Shop' } }));
const managedApi = vi.hoisted(() => ({ createManaged: vi.fn(), update: vi.fn() }));
vi.mock('../services/barbers.service', () => ({ barbersService: managedApi }));
vi.mock('../services/storage.service', () => ({ storageService: { uploadImage: vi.fn() } }));
vi.mock('../hooks/useGeoLocation', () => ({ useGeoLocation: () => ({ dialCode: '+965' }) }));
const api = vi.hoisted(() => ({ check: vi.fn(), send: vi.fn() }));
vi.mock('../context/AppContext', () => ({ useApp: () => state }));
vi.mock('../services/barberInvitations.service', () => ({ barberInvitationsService: api }));
let i18n;
beforeEach(async () => {
 state.reloadData = vi.fn().mockResolvedValue(); state.services = []; managedApi.createManaged.mockReset().mockResolvedValue({ id: 'managed' });
 state.selectedBranch = { id: 'shop', name: 'QA Shop' }; api.check.mockReset().mockResolvedValue({ kind: 'new' }); api.send.mockReset().mockResolvedValue({ delivered: true });
 i18n=i18next.createInstance(); await i18n.init({lng:'en',resources:{en:{translation:en}}});
});
afterEach(cleanup);
function mount() { return render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/dashboard/barbers/new']}><Routes><Route path="/dashboard/barbers/new" element={<AddBarber />} /><Route path="/dashboard/barbers/managed/schedule" element={<h1>Managed hours</h1>} /><Route path="/dashboard/barbers" element={<h1>Barber list</h1>} /></Routes></MemoryRouter></I18nextProvider>); }
const enter = () => fireEvent.change(screen.getByLabelText(en.common.email), { target: { value: 'qa@example.test' } });
it('asks only for email and checks it before sending', async () => {
 mount(); enter(); fireEvent.click(screen.getByRole('button',{name:en.barberInvitations.send}));
 await screen.findByRole('heading',{name:'Barber list'}); expect(api.check).toHaveBeenCalledWith('shop','qa@example.test'); expect(api.send).toHaveBeenCalledWith('shop','qa@example.test',false);
});
it('requires a separate confirmation for an existing customer',async()=>{
 api.check.mockResolvedValue({kind:'customer'});mount();enter();fireEvent.click(screen.getByRole('button',{name:en.barberInvitations.send}));
 const dialog=await screen.findByRole('alertdialog');expect(api.send).not.toHaveBeenCalled();expect(dialog).toHaveTextContent('same account');expect(dialog).toHaveTextContent('qa@example.test');
 fireEvent.click(within(dialog).getByRole('button',{name:en.barberInvitations.send}));await screen.findByRole('heading',{name:'Barber list'});expect(api.send).toHaveBeenCalledWith('shop','qa@example.test',true);
});
it('shows an occupied staff email error without creating an invitation',async()=>{
 api.check.mockRejectedValue(new Error('EMAIL_UNAVAILABLE'));mount();enter();fireEvent.click(screen.getByRole('button',{name:en.barberInvitations.send}));
 expect(await screen.findByRole('alert')).toHaveTextContent(en.barberInvitations.errors.EMAIL_UNAVAILABLE);expect(api.send).not.toHaveBeenCalled();expect(screen.getByLabelText(en.common.email)).toHaveValue('qa@example.test');
});
it('blocks invitations before shop creation',()=>{state.selectedBranch=null;mount();expect(screen.getByRole('alert')).toHaveTextContent(en.barberInvitations.errors.SHOP_REQUIRED);expect(screen.getByRole('button',{name:en.barberInvitations.send})).toBeDisabled();});

it('creates managed profile using only a name, without email or invitation', async () => {
 mount(); fireEvent.click(screen.getByRole('tab', { name: en.managedBarbers.add }));
 expect(screen.queryByLabelText(en.common.email)).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText(en.common.fullName), { target: { value: 'Managed Barber' } });
 fireEvent.click(screen.getByRole('button', { name: en.barbers.addBarber }));
 await screen.findByRole('heading', { name: 'Managed hours' });
 expect(managedApi.createManaged).toHaveBeenCalledWith('shop', expect.objectContaining({ name: 'Managed Barber', phone: '', services: [], isActive: false, id: expect.any(String) }));
 expect(managedApi.createManaged.mock.calls[0][1]).not.toHaveProperty('email');
 expect(api.send).not.toHaveBeenCalled();
});

it('waits for a selected shop before exposing the managed form',()=>{
 state.selectedBranch=null;mount();fireEvent.click(screen.getByRole('tab',{name:en.managedBarbers.add}));
 expect(screen.queryByLabelText(en.common.fullName)).not.toBeInTheDocument();
 expect(screen.getByRole('alert')).toHaveTextContent(en.barberInvitations.errors.SHOP_REQUIRED);
});

it('rejects short names and invalid optional phones without making a request',async()=>{
 mount();fireEvent.click(screen.getByRole('tab',{name:en.managedBarbers.add}));
 fireEvent.change(screen.getByLabelText(en.common.fullName),{target:{value:'A'}});
 fireEvent.click(screen.getByRole('button',{name:en.barbers.addBarber}));
 expect(screen.getByText(en.managerAudit.nameLength)).toBeVisible();expect(managedApi.createManaged).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText(en.common.fullName),{target:{value:'Managed QA'}});
 fireEvent.change(screen.getByLabelText(en.managedBarbers.phoneOptional),{target:{value:'123'}});
 fireEvent.click(screen.getByRole('button',{name:en.barbers.addBarber}));
 expect(screen.getByRole('alert')).toHaveTextContent(en.validation.invalidPhone);expect(managedApi.createManaged).not.toHaveBeenCalled();
});
