import React from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {I18nextProvider} from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import CustomerEmailCallback from './CustomerEmailCallback';
const auth=vi.hoisted(()=>({finishEmail:vi.fn(),ensureEmailProfile:vi.fn(),refresh:vi.fn(),nativeRecoveryDelivery:vi.fn()}));
const native=vi.hoisted(()=>vi.fn());
vi.mock('../context/CustomerAuthContext',()=>({useCustomerAuth:()=>({refresh:auth.refresh})}));
vi.mock('../services/customerAuth.service',()=>({customerAuthService:auth}));
vi.mock('../lib/runtimeConfig',()=>({appConfig:{}}));
vi.mock('../lib/nativeEmailReturn',()=>({nativeEmailReturn:native}));
let i18n;
beforeEach(async()=>{vi.resetAllMocks();native.mockReturnValue(null);sessionStorage.clear();window.history.replaceState({},'', '/customer/email-callback?next=work&type=signup&token_hash=test');auth.finishEmail.mockResolvedValue({recovery:false,returnTo:'/customer/account'});i18n=i18next.createInstance();await i18n.init({lng:'en',resources:{en:{translation:en}}});});
afterEach(()=>{cleanup();window.history.replaceState({},'','/');});
function mount(){return render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/customer/email-callback']}><Routes><Route path="/customer/email-callback" element={<CustomerEmailCallback/>}/><Route path="/customer/reset-password" element={<h1>Reset password</h1>}/></Routes></MemoryRouter></I18nextProvider>);}
it('completes work email verification without sending the manager into customer profile setup',async()=>{
 sessionStorage.setItem('barber-pending-manager-registration','pending');mount();
 await screen.findByRole('heading',{name:en.auth.registrationVerifiedTitle});
 expect(auth.finishEmail).toHaveBeenCalledTimes(1);expect(auth.ensureEmailProfile).not.toHaveBeenCalled();expect(sessionStorage.getItem('barber-pending-manager-registration')).toBeNull();
 expect(screen.getByRole('link',{name:en.auth.signIn})).toHaveAttribute('href','/login');
});
it('keeps recovery links on their existing reset flow',async()=>{
 auth.finishEmail.mockResolvedValue({recovery:true,returnTo:'/customer/account'});mount();await screen.findByRole('heading',{name:'Reset password'});expect(screen.queryByRole('heading',{name:en.auth.registrationVerifiedTitle})).not.toBeInTheDocument();
});
it('hands Android email verification back without adopting a browser session',async()=>{
 window.history.replaceState({},'', '/customer/email-callback?client=android&type=signup&token_hash=test');
 native.mockImplementation(()=>{throw Error('NATIVE_DELIVERY_REQUIRED');});
 const destination='https://barber-auth-test.alabdullah-cs.workers.dev/auth/email?requestId=opaque';
 auth.nativeRecoveryDelivery.mockResolvedValue(destination);mount();
 const link=await screen.findByRole('link',{name:en.customerPassword.openApp});
 expect(link).toHaveAttribute('href',destination);expect(auth.nativeRecoveryDelivery).toHaveBeenCalledTimes(1);
 expect(auth.finishEmail).not.toHaveBeenCalled();expect(auth.ensureEmailProfile).not.toHaveBeenCalled();expect(auth.refresh).not.toHaveBeenCalled();
 expect(window.location.search).toBe('');
});
it('shows a stable Android browser fallback without redirect or token consumption',async()=>{
 window.history.replaceState({},'', '/customer/email-callback?client=android&native_fallback=1');
 native.mockImplementation(()=>{throw Error('ANDROID_NATIVE_FALLBACK');});mount();
 await screen.findByRole('heading',{name:en.customerPassword.androidOpenTitle});
 expect(screen.getByText(en.customerPassword.androidFallback)).toBeInTheDocument();
 expect(auth.nativeRecoveryDelivery).not.toHaveBeenCalled();expect(auth.finishEmail).not.toHaveBeenCalled();
 expect(screen.queryByRole('link',{name:en.customerPassword.openApp})).not.toBeInTheDocument();
});
it('keeps the established iPhone native link separate',async()=>{
 window.history.replaceState({},'', '/customer/email-callback?client=ios');
 native.mockReturnValue('barberplusplus-test://auth/email?opaque=1');mount();
 const link=await screen.findByRole('link',{name:en.customerPassword.openApp});
 expect(link).toHaveAttribute('href','barberplusplus-test://auth/email?opaque=1');
 expect(auth.finishEmail).not.toHaveBeenCalled();expect(auth.nativeRecoveryDelivery).not.toHaveBeenCalled();
});
