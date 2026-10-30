import { afterEach, describe, expect, it } from 'vitest';
import { shopTerminology, shopWording, setTerminologyRole } from './customerTerminology';
afterEach(() => { setTerminologyRole(null); });
describe('customer terminology and booking return', () => {
  it('uses shop wording for public/customer/staff interfaces and preserves admin wording', () => {
    expect(shopWording('Branches in your city · City Centre branch')).toBe('Shops in your city · City Centre shop');
    expect(shopWording('اختر الفرع من فروع المدينة')).toBe('اختر الصالون من صالونات المدينة');
    for (const role of [null, 'customer', 'manager', 'agent', 'barber']) { setTerminologyRole(role); expect(shopTerminology.process('Choose a branch')).toBe('Choose a shop'); }
    setTerminologyRole('admin'); expect(shopTerminology.process('Branches')).toBe('Branches');
  });
});
