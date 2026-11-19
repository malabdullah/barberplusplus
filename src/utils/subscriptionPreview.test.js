import { describe, expect, it } from 'vitest';
import { previewQuote, previewAccess, validatePreviewGrant, previewFixedFils } from './subscriptionPreview';

describe('approved subscription examples (preview calculator)',()=>{
  it.each([[1,25000,250000],[2,25000,250000],[3,30000,300000],[6,60000,600000],[15,150000,1500000]])('prices %i barbers with the monthly minimum and ten-month annual total',(count,monthly,yearly)=>{
    expect(previewQuote(count,'monthly').total).toBe(monthly);
    expect(previewQuote(count,'yearly').total).toBe(yearly);
  });
  it('applies discounts after the minimum and retains the full renewal price',()=>{
    const code={enabled:true,expiresOn:'2026-12-31',limit:null,eligibility:'monthly',type:'percent',value:20};
    expect(previewQuote(2,'monthly',code)).toMatchObject({subtotal:25000,discount:5000,total:20000});
    expect(previewQuote(6,'yearly',{...code,eligibility:'yearly'})).toMatchObject({subtotal:600000,total:480000});
  });
  it('rejects a monthly offer on an annual quote, expiry, pause and exhausted codes',()=>{
    const code={enabled:true,expiresOn:'2026-12-31',limit:1,used:0,eligibility:'monthly',type:'fixed',value:10000};
    expect(previewQuote(6,'yearly',code).error).toBe('codeIneligible');
    expect(previewQuote(6,'monthly',{...code,used:1}).error).toBe('codeUsed');
    expect(previewQuote(6,'monthly',{...code,enabled:false}).error).toBe('codeExpired');
    expect(previewQuote(6,'monthly',{...code,expiresOn:'2026-11-18'}).error).toBe('codeExpired');
  });
  it('caps a fixed discount at the invoice total rather than creating a negative charge',()=>{
    expect(previewQuote(1,'monthly',{enabled:true,expiresOn:'2026-12-31',limit:null,eligibility:'both',type:'fixed',value:50000}).total).toBe(0);
  });
  it.each([0,-1,1.2,NaN,Infinity,10001])('rejects invalid or out-of-preview-range count %s',count=>expect(previewQuote(count,'monthly').error).toBe('invalidCount'));
  it('preserves three-decimal KD amounts without floating point multiplication',()=>{
    expect(previewFixedFils('2.501')).toBe(2501);
    expect(previewFixedFils('2.5')).toBe(2500);
    expect(previewFixedFils('2.0001')).toBeNull();
    expect(previewFixedFils('-1')).toBeNull();
  });
});

describe('preview access exceptions',()=>{
  const business={status:'expired',shops:[{id:'one'}]};
  const grant={type:'manual',startsOn:'2026-11-19',endsOn:'2026-11-26',reason:'Support exception',shopIds:['one']};
  it('requires a reason, valid dates and a branch owned by this business',()=>{
    expect(validatePreviewGrant(grant,business)).toBeNull();
    expect(validatePreviewGrant({...grant,reason:' '},business)).toBe('reasonRequired');
    expect(validatePreviewGrant({...grant,endsOn:grant.startsOn},business)).toBe('invalidDates');
    expect(validatePreviewGrant({...grant,startsOn:'2026-02-31'},business)).toBe('invalidDates');
    expect(validatePreviewGrant({...grant,shopIds:['foreign']},business)).toBe('shopRequired');
    expect(validatePreviewGrant({...grant,shopIds:[]},business)).toBe('shopRequired');
  });
  it('leaves paid access in place and never applies future or expired exceptions early',()=>{
    expect(previewAccess({...business,status:'active',grant})).toBe('active');
    expect(previewAccess({...business,grant})).toBe('manual');
    expect(previewAccess({...business,grant:{...grant,type:'full'}})).toBe('complimentary');
    expect(previewAccess({...business,grant:{...grant,startsOn:'2026-11-20'}})).toBe('expired');
    expect(previewAccess({...business,grant:{...grant,endsOn:'2026-11-19'}})).toBe('expired');
    expect(previewAccess({...business,grant:null})).toBe('expired');
  });
});
