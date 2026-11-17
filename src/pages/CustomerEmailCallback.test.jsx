import React from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {I18nextProvider} from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import CustomerEmailCallback from './CustomerEmailCallback';
const auth=vi.hoisted(()=>({finishEmail:vi.fn(),confirmSignup:vi.fn(),ensureEmailProfile:vi.fn(),refresh:vi.fn()}));
vi.mock('../context/CustomerAuthContext',()=>({useCustomerAuth:()=>({refresh:auth.refresh})}));
vi.mock('../services/customerAuth.service',()=>({customerAuthService:auth}));
vi.mock('../services/signupConfirmation.service',()=>({confirmSignup:auth.confirmSignup}));
vi.mock('../lib/runtimeConfig',()=>({appConfig:{}}));
vi.mock('../lib/nativeEmailReturn',()=>({nativeEmailReturn:()=>null}));
let i18n;
beforeEach(async()=>{vi.resetAllMocks();sessionStorage.clear();window.history.replaceState({},'', '/customer/email-callback?next=work&type=signup&token_hash=test');auth.finishEmail.mockResolvedValue({recovery:false,returnTo:'/customer/account'});i18n=i18next.createInstance();await i18n.init({lng:'en',resources:{en:{translation:en}}});});
afterEach(()=>{cleanup();window.history.replaceState({},'','/');});
function mount(){return render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/customer/email-callback']}><Routes><Route path="/customer/email-callback" element={<CustomerEmailCallback/>}/><Route path="/customer/reset-password" element={<h1>Reset password</h1>}/><Route path="/login" element={<h1>Team sign in</h1>}/><Route path="/customer/sign-in" element={<h1>Customer sign in</h1>}/></Routes></MemoryRouter></I18nextProvider>);}
it('completes work email verification without sending the manager into customer profile setup',async()=>{
 sessionStorage.setItem('barber-pending-manager-registration','pending');mount();
 await screen.findByRole('heading',{name:'Team sign in'});
 expect(auth.finishEmail).toHaveBeenCalledTimes(1);expect(auth.ensureEmailProfile).not.toHaveBeenCalled();expect(sessionStorage.getItem('barber-pending-manager-registration')).toBeNull();
 expect(screen.queryByRole('button',{name:/confirm/i})).not.toBeInTheDocument();
});
it('automatically confirms a direct signup fragment once and continues to sign-in',async()=>{
 window.history.replaceState({},'','/customer/email-callback?next=book#type=signup&token_hash='+'a'.repeat(56));
 auth.confirmSignup.mockResolvedValue({signInRequired:true,returnTo:'/book'});mount();
 await screen.findByRole('heading',{name:'Customer sign in'});
 expect(auth.confirmSignup).toHaveBeenCalledTimes(1);expect(auth.finishEmail).not.toHaveBeenCalled();expect(window.location.hash).toBe('');
});
it('shows confirmation without switching an existing account',async()=>{
 window.history.replaceState({},'','/customer/email-callback#type=signup&token_hash='+'a'.repeat(56));
 auth.confirmSignup.mockResolvedValue({sessionPreserved:true,returnTo:'/customer/account'});mount();
 await screen.findByText(en.customerAuth.email.currentSessionPreserved);
 expect(auth.ensureEmailProfile).not.toHaveBeenCalled();expect(auth.refresh).not.toHaveBeenCalled();
});
it('keeps recovery links on their existing reset flow',async()=>{
 auth.finishEmail.mockResolvedValue({recovery:true,returnTo:'/customer/account'});mount();await screen.findByRole('heading',{name:'Reset password'});expect(screen.queryByRole('heading',{name:en.auth.registrationVerifiedTitle})).not.toBeInTheDocument();
});
