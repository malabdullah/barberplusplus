import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import { SubscriptionPreviewProvider } from '../context/SubscriptionPreviewContext';
import AdminSubscriptionsPreview from './AdminSubscriptionsPreview';

const previousShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'showModal');
const previousClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'close');
let i18n;
beforeAll(()=>{
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value(){this.open=false;}});
});
afterAll(()=>{
  if(previousShow) Object.defineProperty(HTMLDialogElement.prototype,'showModal',previousShow); else delete HTMLDialogElement.prototype.showModal;
  if(previousClose) Object.defineProperty(HTMLDialogElement.prototype,'close',previousClose); else delete HTMLDialogElement.prototype.close;
});
beforeEach(async()=>{
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  i18n=i18next.createInstance();
  await i18n.init({lng:'en',resources:{en:{translation:en}},interpolation:{escapeValue:false}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const show = (codesOnly=false) => render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[codesOnly?'/design/discounts':'/design/subscriptions/classic']}><SubscriptionPreviewProvider><Routes><Route path="/design/discounts" element={<AdminSubscriptionsPreview codesOnly/>}/><Route path="/design/subscriptions/:businessId" element={<AdminSubscriptionsPreview/>}/></Routes></SubscriptionPreviewProvider></MemoryRouter></I18nextProvider>);

it('retains input-edited grant dates when another field changes and rejects an empty period',async()=>{
  show();
  fireEvent.click(screen.getByRole('button',{name:'Manage access'}));
  fireEvent.input(screen.getByLabelText('Ends on'),{target:{value:'2026-11-19'}});
  fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Preview date regression'}});
  expect(screen.getByLabelText('Ends on')).toHaveValue('2026-11-19');
  fireEvent.submit(screen.getByRole('button',{name:'Save preview'}).closest('form'));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.subscriptionDesign.invalidDates);
  fireEvent.input(screen.getByLabelText('Ends on'),{target:{value:'2026-11-26'}});
  fireEvent.submit(screen.getByRole('button',{name:'Save preview'}).closest('form'));
  expect(await screen.findByText(en.subscriptionDesign.accessSaved)).toBeInTheDocument();
});

it('retains the edited redemption deadline while completing the code form',async()=>{
  show(true);
  fireEvent.click(screen.getByRole('button',{name:'Create code'}));
  fireEvent.change(screen.getByLabelText('Code'),{target:{value:'QA20'}});
  fireEvent.input(screen.getByLabelText('Redeem by'),{target:{value:'2027-01-31'}});
  fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Preview expiry regression'}});
  expect(screen.getByLabelText('Redeem by')).toHaveValue('2027-01-31');
  fireEvent.submit(screen.getByRole('button',{name:'Create preview code'}).closest('form'));
  expect(await screen.findByText(en.subscriptionDesign.codeSaved)).toBeInTheDocument();
  expect(screen.getAllByText('QA20').length).toBeGreaterThan(0);
});
