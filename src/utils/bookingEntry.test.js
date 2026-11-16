import { beforeEach, expect, it, vi } from 'vitest';
import { parseBookingEntry, bookingEntryPath, bookingEntryDraft, hasBookingSelection } from './bookingEntry';
const shop = '10000000-0000-4000-8000-000000000011';
const barber = '30000000-0000-4000-8000-000000000112';
beforeEach(() => vi.restoreAllMocks());
it('accepts exactly one public catalog selection and rejects ambiguous or injected parameters', () => {
 expect(parseBookingEntry(`?shop=${shop}`)).toEqual({ kind: 'shop', targetId: shop });
 expect(parseBookingEntry(`?barber=${barber}`)).toEqual({ kind: 'barber', targetId: barber });
 for(const query of [`?shop=${shop}&barber=${barber}`,`?shop=${shop}&shop=${shop}`,`?shop=${shop}&next=https://foreign.example`,`?shop=bad`,`?barber=${barber}#bad`]) expect(parseBookingEntry(query)).toEqual({invalid:true});
 expect(parseBookingEntry('?next=book')).toBeNull();
 expect(bookingEntryPath('shop',shop)).toBe(`/book?shop=${shop}`);
 expect(bookingEntryPath('booking',shop)).toBeNull();expect(bookingEntryPath('shop','https://foreign.example')).toBeNull();
});
it('starts a shop at barbers, and a barber at services, with no inherited booking details', () => {
 const source={kind:'shop',city:'Sharq',branchId:shop,barberId:barber,serviceIds:['old'],date:'2000-01-01',time:'10:00',email:'PRIVATE',receipt:'PRIVATE'};
 const a=bookingEntryDraft(source),b=bookingEntryDraft({...source,kind:'barber'});
 expect(a).toMatchObject({city:'Sharq',branchId:shop,barberId:'',panel:'barber',finderStage:'results',serviceIds:[],time:'',step:0});
 expect(b).toMatchObject({branchId:shop,barberId:barber,panel:'services',step:1,serviceIds:[],time:''});
 expect(a.date).not.toBe('2000-01-01');expect(JSON.stringify(b)).not.toContain('PRIVATE');
 expect(()=>bookingEntryDraft({...source,city:''})).toThrow('INVALID_SELECTION');
});
it('protects any meaningful in-progress selection without treating an untouched default date as a booking', () => {
 expect(hasBookingSelection(null)).toBe(false);expect(hasBookingSelection({date:'2026-11-16'})).toBe(false);
 for(const field of [{city:'Sharq'},{bookingMode:'time'},{barberId:barber},{serviceIds:['service']},{details:{name:'Guest'}}]) expect(hasBookingSelection(field)).toBe(true);
});
