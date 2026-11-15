import React from 'react';
import {beforeEach,afterEach,expect,it,vi}from'vitest';
import{cleanup,fireEvent,render,screen,waitFor,within}from'@testing-library/react';
import{MemoryRouter}from'react-router-dom';
import{I18nextProvider}from'react-i18next';
import i18next from'i18next';
import en from'../../i18n/locales/en.json';
import Administrators from'./Administrators';
const api=vi.hoisted(()=>Object.fromEntries(['list','invite','resend','cancel','edit','setEnabled','remove','resetPassword'].map(k=>[k,vi.fn()])));
vi.mock('../../services/administrators.service',()=>({administratorsService:api}));
const person={id:'admin-id',name:'Test Admin',email:'admin@example.test',kind:'account',role:'admin',status:'active',enabled:true};
let i18n;
beforeEach(async()=>{
 vi.resetAllMocks();api.list.mockResolvedValue({users:[{...person,id:'super-id',name:'Super',email:'super@example.test',role:'super_admin'},person],hasMore:false});
 for(const key of ['invite','resend','cancel','edit','setEnabled','remove','resetPassword'])api[key].mockResolvedValue({success:true,delivered:true});
 i18n=i18next.createInstance();await i18n.init({lng:'en',resources:{en:{translation:en}},interpolation:{escapeValue:false}});
});
afterEach(cleanup);
function mount(){return render(<I18nextProvider i18n={i18n}><MemoryRouter><Administrators/></MemoryRouter></I18nextProvider>);}
async function ready(){await screen.findByText(person.email);}
it('invites a new email directly with name and never asks for a customer account',async()=>{
 mount();await ready();
 fireEvent.change(screen.getByLabelText(en.common.fullName),{target:{value:'New Admin'}});
 fireEvent.change(screen.getByLabelText(en.customerAuth.email.label),{target:{value:' NEW@example.test '}});
 fireEvent.submit(screen.getByRole('button',{name:en.administrators.add}).closest('form'));
 await waitFor(()=>expect(api.invite).toHaveBeenCalledWith('New Admin','new@example.test'));
 expect(await screen.findByText(en.administrators.sent)).toBeVisible();
 expect(screen.getByLabelText(en.common.fullName)).toHaveValue('');
});
it('shows occupied-email and delivery failures without hiding the form',async()=>{
 api.invite.mockRejectedValueOnce(Error('EMAIL_IN_USE'));mount();await ready();
 fireEvent.change(screen.getByLabelText(en.common.fullName),{target:{value:'New Admin'}});
 fireEvent.change(screen.getByLabelText(en.customerAuth.email.label),{target:{value:'taken@example.test'}});
 fireEvent.submit(screen.getByRole('button',{name:en.administrators.add}).closest('form'));
 expect(await screen.findByRole('alert')).toHaveTextContent(en.administrators.errors.EMAIL_IN_USE);
 expect(screen.getByLabelText(en.customerAuth.email.label)).toHaveValue('taken@example.test');
 api.invite.mockResolvedValue({delivered:false});
 fireEvent.submit(screen.getByRole('button',{name:en.administrators.add}).closest('form'));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(en.administrators.errors.EMAIL_DELIVERY_FAILED));
});
it('keeps Super Admin protected and edits an Admin from the same page',async()=>{
 mount();await ready();expect(screen.getAllByRole('button',{name:en.common.edit})).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:en.common.edit}));
 expect(screen.getByRole('heading',{name:en.administrators.edit})).toBeVisible();
});
it('submits the edited account together with its previous email for stale-write detection',async()=>{
 const ui=mount();await ready();fireEvent.click(screen.getByRole('button',{name:en.common.edit}));
 const form=ui.container.querySelector('.administrator-editor');const controls=within(form);
 fireEvent.change(controls.getByLabelText(en.common.fullName),{target:{value:'Changed Admin'}});
 fireEvent.change(controls.getByLabelText(en.customerAuth.email.label),{target:{value:'changed@example.test'}});
 fireEvent.submit(form);
 await waitFor(()=>expect(api.edit).toHaveBeenCalledWith({userId:'admin-id',expectedEmail:'admin@example.test',name:'Changed Admin',email:'changed@example.test'}));
});
it('requires an explicit named confirmation before deleting an Admin',async()=>{
 mount();await ready();fireEvent.click(screen.getByText(en.administrators.more));
 fireEvent.click(screen.getByRole('button',{name:en.common.delete,exact:true}));
 const dialog=screen.getByRole('alertdialog');expect(dialog).toHaveTextContent(person.email);expect(api.remove).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:en.common.cancel}));expect(api.remove).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText(en.administrators.more));fireEvent.click(screen.getByRole('button',{name:en.common.delete,exact:true}));
 fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:en.common.confirm}));
 await waitFor(()=>expect(api.remove).toHaveBeenCalledWith('admin-id'));
});
it('manages pending invitations from the directory',async()=>{
 api.list.mockResolvedValue({users:[{...person,kind:'invitation',status:'invited'}],hasMore:false});mount();await ready();
 expect(screen.queryByRole('button',{name:en.common.edit})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:en.administrators.resend}));await waitFor(()=>expect(api.resend).toHaveBeenCalledWith('admin-id'));
 fireEvent.click(screen.getByRole('button',{name:en.common.cancel}));fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:en.common.confirm}));
 await waitFor(()=>expect(api.cancel).toHaveBeenCalledWith('admin-id'));
});
