import { afterEach, describe, expect, it } from 'vitest';
import { shopTerminology, shopWording, setTerminologyRole } from './customerTerminology';
import { readBookingDraft, saveBookingDraft } from './customerBookingDraft';
afterEach(() => { setTerminologyRole(null); sessionStorage.clear(); });
describe('customer terminology and booking return', () => {
  it('uses shop wording for public/customer/staff interfaces and preserves admin wording', () => {
    expect(shopWording('Branches in your city · City Centre branch')).toBe('Shops in your city · City Centre shop');
    expect(shopWording('اختر الفرع من فروع المدينة')).toBe('اختر الصالون من صالونات المدينة');
    for (const role of [null, 'customer', 'manager', 'agent', 'barber']) { setTerminologyRole(role); expect(shopTerminology.process('Choose a branch')).toBe('Choose a shop'); }
    setTerminologyRole('admin'); expect(shopTerminology.process('Branches')).toBe('Branches');
  });
  it('restores only a recent booking selection and clears it after confirmation', () => {
    const selection = { city: 'Kuwait City', branchId: 'shop', barberId: 'barber', serviceIds: ['hair'], date: '2026-10-31', time: '10:00', step: 2 };
    saveBookingDraft(selection); expect(readBookingDraft()).toMatchObject(selection);
    expect(Object.keys(readBookingDraft())).not.toContain('password');
    saveBookingDraft(null); expect(readBookingDraft()).toBeNull();
    sessionStorage.setItem('barber-customer-booking-draft', JSON.stringify({ ...selection, savedAt: Date.now() - 3600001 })); expect(readBookingDraft()).toBeNull();
  });
});
