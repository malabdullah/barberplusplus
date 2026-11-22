import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ServiceDurationEditor from './ServiceDurationEditor';
import { saveServiceDuration } from '../../services/serviceDurations.service';
vi.mock('../../services/serviceDurations.service', () => ({ saveServiceDuration: vi.fn() }));
vi.mock('react-i18next', () => ({useTranslation:()=>({t:key=>key,i18n:{language:'en'}})}));
const barber={id:'one',services:['hair'],serviceDurations:{}};
const services=[{id:'hair',name:'Haircut',duration:30,status:'active'},{id:'other',name:'Other',duration:15,status:'active'}];
beforeEach(()=>vi.clearAllMocks());
afterEach(cleanup);
it('offers only assigned durations and leaves prices out of the editor',()=>{
 render(<ServiceDurationEditor barber={barber} services={services}/>);
 expect(screen.getByLabelText('Haircut')).toHaveValue(30);
 expect(screen.queryByText('Other')).not.toBeInTheDocument();
 expect(screen.getByText('serviceDurations.reset')).toBeDisabled();
});
it('rejects invalid duration before submitting',()=>{
 render(<ServiceDurationEditor barber={barber} services={services}/>);
 fireEvent.change(screen.getByLabelText('Haircut'),{target:{value:'4'}});
 fireEvent.click(screen.getByText('common.save'));
 expect(screen.getByRole('alert')).toHaveTextContent('serviceDurations.invalid');
 expect(saveServiceDuration).not.toHaveBeenCalled();
});
it('saves the override and resets to the current shop default',async()=>{
 saveServiceDuration.mockResolvedValueOnce({hair:45}).mockResolvedValueOnce({});
 render(<ServiceDurationEditor barber={barber} services={services}/>);
 fireEvent.change(screen.getByLabelText('Haircut'),{target:{value:'45'}});
 fireEvent.click(screen.getByText('common.save'));
 await waitFor(()=>expect(screen.getByText('serviceDurations.reset')).toBeEnabled());
 expect(saveServiceDuration).toHaveBeenCalledWith('one','hair',45);
 fireEvent.click(screen.getByText('serviceDurations.reset'));
 await waitFor(()=>expect(screen.getByLabelText('Haircut')).toHaveValue(30));
 expect(saveServiceDuration).toHaveBeenLastCalledWith('one','hair',null);
});
