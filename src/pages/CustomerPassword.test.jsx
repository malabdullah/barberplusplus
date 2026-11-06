import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import CustomerPassword from './CustomerPassword';
import { customerAuthService } from '../services/customerAuth.service';
vi.mock('../services/customerAuth.service',()=>({customerAuthService:{passwordStatus:vi.fn(),changePassword:vi.fn(),resetPassword:vi.fn(),setupPassword:vi.fn()}}));
let i18n;
beforeEach(async()=>{vi.resetAllMocks();sessionStorage.clear();i18n=i18next.createInstance();await i18n.init({lng:'en',resources:{en:{translation:en},ar:{translation:ar}},interpolation:{escapeValue:false}});});
afterEach(cleanup);
const mount=()=>render(<I18nextProvider i18n={i18n}><MemoryRouter><CustomerPassword /></MemoryRouter></I18nextProvider>);
it('uses current/new/confirm for a password-capable account even when Google is linked',async()=>{
 customerAuthService.passwordStatus.mockResolvedValue({hasPassword:true,providers:['email','google'],email:'trusted@example.test'});mount();
 const current=await screen.findByLabelText(en.customerPassword.currentPassword);expect(current).toHaveAttribute('autocomplete','current-password');
 expect(screen.queryByLabelText(en.customerAuth.email.label)).not.toBeInTheDocument();
 fireEvent.change(current,{target:{value:'Current12!'}});fireEvent.change(screen.getByLabelText(en.customerAuth.newPassword),{target:{value:'Newpass12!'}});fireEvent.change(screen.getByLabelText(en.customerAuth.confirmPassword),{target:{value:'Newpass12!'}});
 fireEvent.click(screen.getByRole('button',{name:en.customerPassword.saveChange}));
 expect(await screen.findByRole('status')).toHaveTextContent(en.customerPassword.success);
 expect(customerAuthService.changePassword).toHaveBeenCalledWith({currentPassword:'Current12!',password:'Newpass12!',confirmPassword:'Newpass12!'});
 expect(screen.getByRole('link',{name:en.customerAuth.signIn})).toHaveAttribute('href','/customer/sign-in');
});
it('offers provider-only accounts email verification instead of a provider password field',async()=>{
 customerAuthService.passwordStatus.mockResolvedValue({hasPassword:false,providers:['apple'],email:'relay@example.test',canVerifyEmail:true});mount();
 expect(await screen.findByText(en.customerPassword.providerOnly)).toBeInTheDocument();
 expect(screen.queryByLabelText(en.customerPassword.currentPassword)).not.toBeInTheDocument();expect(screen.queryByLabelText(en.customerAuth.newPassword)).not.toBeInTheDocument();
 expect(screen.getByText('relay@example.test')).toBeInTheDocument();expect(screen.getByRole('button',{name:en.customerPassword.sendCode})).toBeEnabled();
});
it('keeps a wrong-current-password error on the current form',async()=>{
 customerAuthService.passwordStatus.mockResolvedValue({hasPassword:true});customerAuthService.changePassword.mockRejectedValue(Error('WRONG_CURRENT_PASSWORD'));mount();
 await screen.findByLabelText(en.customerPassword.currentPassword);fireEvent.click(screen.getByRole('button',{name:en.customerPassword.saveChange}));
 expect(await screen.findByRole('alert')).toHaveTextContent(en.customerPassword.errors.WRONG_CURRENT_PASSWORD);expect(screen.getByLabelText(en.customerPassword.currentPassword)).toBeInTheDocument();
});
it('renders the signed-in password fields in Arabic and RTL',async()=>{
 await i18n.changeLanguage('ar');customerAuthService.passwordStatus.mockResolvedValue({hasPassword:true});mount();
 expect((await screen.findByLabelText(ar.customerPassword.currentPassword)).closest('.customer-booking')).toHaveAttribute('dir','rtl');
});
