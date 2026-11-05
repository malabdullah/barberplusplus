import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { CustomerAuthProvider, useCustomerAuth } from './CustomerAuthContext';
const getProfile = vi.hoisted(() => vi.fn());
vi.mock('../lib/runtimeConfig', () => ({customerFeaturesEnabled:true}));
vi.mock('../services/customerAuth.service', () => ({customerAuthService:{getProfile,subscribe:()=>({unsubscribe:vi.fn()})}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
function View(){
  const {customer,loading}=useCustomerAuth();
  return <><Link to="/customer/account">Personal</Link><output>{loading?'loading':JSON.stringify(customer)}</output></>;
}
it('refreshes ownership on returning from work so a newly created chair cannot be selected as a customer',async()=>{
  getProfile.mockResolvedValueOnce({id:'manager',ownBarberIds:[]});
  render(<MemoryRouter initialEntries={['/dashboard/my-chair']}><CustomerAuthProvider><View /></CustomerAuthProvider></MemoryRouter>);
  await screen.findByText('{"id":"manager","ownBarberIds":[]}');
  getProfile.mockResolvedValueOnce({id:'manager',ownBarberIds:['new-chair']});
  fireEvent.click(screen.getByRole('link',{name:'Personal'}));
  await screen.findByText('{"id":"manager","ownBarberIds":["new-chair"]}');
  expect(getProfile).toHaveBeenCalledTimes(2);
});
