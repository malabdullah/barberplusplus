import React from 'react';
import {afterEach,beforeEach,expect,it,vi}from'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor}from'@testing-library/react';
import {BrowserRouter}from'react-router-dom';
import {I18nextProvider}from'react-i18next';
import i18next from'i18next';
import en from'../i18n/locales/en.json';
import AcceptAdminInvitation from'./AcceptAdminInvitation';
const mock=vi.hoisted(()=>({resolve:vi.fn(),accept:vi.fn(),getSession:vi.fn(),signOut:vi.fn(),signInWithPassword:vi.fn()}));
vi.mock('../services/administrators.service',()=>({administratorsService:mock}));
vi.mock('../lib/supabase',()=>({supabase:{auth:mock}}));
vi.mock('../components/Customer/CustomerAuthLayout',()=>({default:({children})=><section>{children}</section>}));
const id='a1111111-1111-4111-8111-111111111111';
let i18n;
beforeEach(async()=>{
 vi.resetAllMocks();sessionStorage.clear();window.history.replaceState(null,'','/accept-admin-invite?invitation='+id+'#token='+'a'.repeat(64));
 mock.getSession.mockResolvedValue({data:{session:null}});
 mock.resolve.mockImplementation(input=>Promise.resolve({name:'QA',email:input.token[0]==='a'?'old@example.test':'new@example.test'}));
 mock.accept.mockResolvedValue({success:true});
 mock.signInWithPassword.mockResolvedValue({error:{message:'Use login'}});
 i18n=i18next.createInstance();await i18n.init({lng:'en',resources:{en:{translation:en}},interpolation:{escapeValue:false}});
});
afterEach(cleanup);
function mount(){return render(<I18nextProvider i18n={i18n}><BrowserRouter><AcceptAdminInvitation/></BrowserRouter></I18nextProvider>);}
it('loads a replacement link opened in the same tab and removes its token from the address bar',async()=>{
 mount();await screen.findByText('old@example.test');
 expect(window.location.hash).toBe('');
 await act(async()=>{window.history.pushState(null,'','/accept-admin-invite?invitation='+id+'#token='+'b'.repeat(64));window.dispatchEvent(new PopStateEvent('popstate'));});
 expect(await screen.findByText('new@example.test')).toBeVisible();
 expect(mock.resolve).toHaveBeenLastCalledWith({id,token:'b'.repeat(64)});
 expect(window.location.hash).toBe('');
});
it('preserves another signed-in account until the person explicitly chooses to sign out',async()=>{
 mock.getSession.mockResolvedValue({data:{session:{user:{email:'super@example.test'}}}});mount();
 expect(await screen.findByText(en.administrators.switchAccount)).toBeVisible();
 expect(screen.queryByLabelText(en.auth.password)).not.toBeInTheDocument();
 expect(mock.signOut).not.toHaveBeenCalled();expect(mock.accept).not.toHaveBeenCalled();
});
it('rejects mismatched passwords before acceptance',async()=>{
 mount();await screen.findByText('old@example.test');
 fireEvent.change(screen.getByLabelText(en.auth.password),{target:{value:'FirstPassword123!'}});
 fireEvent.change(screen.getByLabelText(en.auth.confirmPassword),{target:{value:'OtherPassword123!'}});
 fireEvent.submit(screen.getByRole('button',{name:en.administrators.accept}).closest('form'));
 expect(await screen.findByRole('alert')).toHaveTextContent(en.administrators.errors.WEAK_PASSWORD);
 expect(mock.accept).not.toHaveBeenCalled();
});
it('accepts only the link-bound email and clears private invitation material after success',async()=>{
 mount();await screen.findByText('old@example.test');
 for(const label of [en.auth.password,en.auth.confirmPassword])fireEvent.change(screen.getByLabelText(label),{target:{value:'FirstPassword123!'}});
 fireEvent.submit(screen.getByRole('button',{name:en.administrators.accept}).closest('form'));
 await waitFor(()=>expect(mock.accept).toHaveBeenCalledWith({id,token:'a'.repeat(64)},'FirstPassword123!'));
 expect(await screen.findByText(en.administrators.accountReady)).toBeVisible();
 expect(mock.signInWithPassword).toHaveBeenCalledWith({email:'old@example.test',password:'FirstPassword123!'});
 expect(sessionStorage.getItem('barber-admin-invite')).toBeNull();
});
