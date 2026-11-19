import React, { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import PreviewShell, { PreviewDialog, PreviewHeading } from '../components/Subscriptions/PreviewShell';
import { useSubscriptionPreview } from '../context/SubscriptionPreviewContext';
import { MAX_PREVIEW_BARBERS, previewQuote } from '../utils/subscriptionPreview';

export default function SubscriptionCalculatorPreview() {
  const {bp,sp,money,codes} = useSubscriptionPreview();
  const [count,setCount] = useState('6');
  const [frequency,setFrequency] = useState('monthly');
  const [codeText,setCodeText] = useState('');
  const [applied,setApplied] = useState('');
  const [codeError,setCodeError] = useState('');
  const [review,setReview] = useState(false);
  const code = codes.find(item=>item.code===applied);
  const quote = previewQuote(count === '' ? NaN : Number(count),frequency,code);
  const error = quote.error || codeError;
  const changeCount = delta => setCount(String(Math.min(MAX_PREVIEW_BARBERS,Math.max(1,(Number(count)||1)+delta))));
  const apply = event => {
    event.preventDefault();
    const target = codes.find(item=>item.code===codeText.trim().toUpperCase());
    if (!target) { setCodeError('codeNotFound'); setApplied(''); return; }
    const result = previewQuote(Number(count),frequency,target);
    if (result.error) { setCodeError(result.error); setApplied(''); return; }
    setApplied(target.code); setCodeError('');
  };
  return <PreviewShell active="calculator"><main className="billing-main subscription-main">
    <PreviewHeading title={sp('calculator')} />
    <div className="subscription-calculator">
      <section className="subscription-calculator-controls" aria-label={sp('estimateInputs')}>
        <h2>{sp('yourTeam')}</h2>
        <label className="subscription-label" htmlFor="calculator-count">{sp('activeCount')}</label>
        <div className="subscription-stepper"><button className="billing-icon" type="button" disabled={Number(count)<=1} onClick={()=>changeCount(-1)} aria-label={sp('decrease')}><Minus size={20}/></button><input id="calculator-count" type="number" min="1" max={MAX_PREVIEW_BARBERS} step="1" inputMode="numeric" value={count} onChange={event=>{setCount(event.target.value);setCodeError('');}} aria-describedby="calculator-rate" aria-invalid={quote.error==='invalidCount'} /><button className="billing-icon" type="button" disabled={Number(count)>=MAX_PREVIEW_BARBERS} onClick={()=>changeCount(1)} aria-label={sp('increase')}><Plus size={20}/></button></div>
        <p id="calculator-rate" className="subscription-subtle">{sp('rate', {rate:money(10000),minimum:money(25000)})}</p>
        <fieldset className="billing-frequency"><legend>{bp('billingFrequency')}</legend>{['monthly','yearly'].map(value=><label className={frequency===value?'is-selected':''} key={value}><input type="radio" name="calculator-frequency" checked={frequency===value} value={value} onChange={()=>{setFrequency(value);setCodeError('');}}/>{bp(value)}</label>)}</fieldset>
        <form className="subscription-code-form" onSubmit={apply}><label className="subscription-label" htmlFor="calculator-code">{sp('discountCode')}</label><div><input id="calculator-code" value={codeText} maxLength={24} autoCapitalize="characters" spellCheck={false} onChange={event=>{setCodeText(event.target.value);setCodeError('');}}/><button className="billing-secondary" type="submit" disabled={!codeText.trim()||quote.error==='invalidCount'}>{sp('apply')}</button></div></form>
        {applied && <div className="subscription-applied"><span>{applied}</span><button className="billing-icon" type="button" aria-label={sp('removeCode')} onClick={()=>{setApplied('');setCodeText('');setCodeError('');}}><X size={16}/></button></div>}
        {error && <p className="subscription-error" role="alert">{sp(error)}</p>}
      </section>
      <section className="subscription-estimate" aria-label={sp('estimate')}>
        <h2>{sp('estimate')}</h2>
        <div className={`billing-price${quote.total>=100000000?' subscription-large-amount':''}`}><div><strong><bdi>{quote.error ? sp('unavailableAmount') : money(quote.total)}</bdi></strong><span>{bp(frequency==='monthly'?'perMonth':'perYear')}</span></div></div>
        <dl className="billing-review-rows">
          <div><dt>{bp('activeBarbers',{count:Number(count)||0})}</dt><dd>{quote.error?sp('unavailableAmount'):money(quote.subtotal)}</dd></div>
          {applied && !quote.error && <div><dt>{sp('discountWithCode',{code:applied})}</dt><dd><bdi>−{money(quote.discount)}</bdi></dd></div>}
          <div className="subscription-total"><dt>{sp('dueAtStart')}</dt><dd><bdi>{quote.error?sp('unavailableAmount'):money(quote.total)}</bdi></dd></div>
          <div><dt>{sp('followingRenewal')}</dt><dd><bdi>{quote.error?sp('unavailableAmount'):money(code?.duration==='threeMonthly'?quote.total:quote.subtotal)}</bdi></dd></div>
          {applied&&!quote.error&&code.duration==='threeMonthly'&&<div><dt>{sp('standardRenewal')}</dt><dd><bdi>{money(quote.subtotal)}</bdi></dd></div>}
        </dl>
        {frequency==='yearly'&&!quote.error&&<p className="billing-savings">{sp('yearlyBaseSaving',{amount:money(quote.yearlySaving)})}</p>}
        {applied&&!quote.error&&<p className="subscription-subtle">{sp('codeDuration',{duration:sp(code.duration==='threeMonthly'?'threeMonthly':'firstPayment')})}</p>}
        <button type="button" className="billing-primary billing-dialog-primary" disabled={!!error} onClick={()=>setReview(true)}>{sp('reviewEstimate')}</button>
      </section>
    </div>
    {review&&!quote.error&&<PreviewDialog title={sp('reviewEstimate')} onClose={()=>setReview(false)}><p className="billing-dialog-caption">{bp('previewLabel')}</p><dl className="billing-review-rows"><div><dt>{sp('activeCount')}</dt><dd>{count}</dd></div><div><dt>{bp('billingFrequency')}</dt><dd>{bp(frequency)}</dd></div><div><dt>{sp('dueAtStart')}</dt><dd><bdi>{money(quote.total)}</bdi></dd></div><div><dt>{sp('followingRenewal')}</dt><dd><bdi>{money(code?.duration==='threeMonthly'?quote.total:quote.subtotal)}</bdi></dd></div></dl><p>{bp('noPayment')}</p><button type="button" className="billing-primary billing-dialog-primary" onClick={()=>setReview(false)}>{sp('backToCalculator')}</button></PreviewDialog>}
  </main></PreviewShell>;
}
