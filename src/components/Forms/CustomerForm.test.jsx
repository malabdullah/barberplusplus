import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:key=>key})}));
vi.mock('../../hooks/useGeoLocation',()=>({useGeoLocation:()=>({dialCode:'+965'})}));
import CustomerForm from './CustomerForm';
it('edits a phone-optional canonical customer without requiring a new phone',()=>{
 const onSubmit=vi.fn();const {container}=render(<CustomerForm customer={{id:'customer',name:'Customer',phone:null}} onSubmit={onSubmit}/>);
 fireEvent.change(container.querySelector('[name="notes"]'),{target:{value:'Staff annotation'}});
 fireEvent.click(screen.getByRole('button',{name:'common.update'}));
 expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({name:'Customer',phone:'',notes:'Staff annotation'}));
});
it('still requires a contact phone when staff create a new guest customer',()=>{
 const onSubmit=vi.fn();const {container}=render(<CustomerForm onSubmit={onSubmit}/>);
 fireEvent.change(container.querySelector('[name="name"]'),{target:{value:'Guest'}});
 fireEvent.click(screen.getByRole('button',{name:'common.create'}));
 expect(onSubmit).not.toHaveBeenCalled();expect(screen.getByText('agent.customers.validation.phoneRequired')).toBeVisible();
});
