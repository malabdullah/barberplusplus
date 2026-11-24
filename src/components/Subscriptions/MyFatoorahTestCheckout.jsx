import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { appConfig } from '../../lib/runtimeConfig';

export const showMyFatoorahTest = appConfig.environment === 'cloud-test'
  && appConfig.cloudTestProjectRef === 'qvkucvcjmojjbphlzlks'
  && appConfig.appUrl === 'https://barber-test.alabdullah-cs.workers.dev';

async function checkout(action, businessId, details) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('MYFATOORAH_FORBIDDEN');
  const params = new URLSearchParams(window.location.search.replace(/\?paymentId=/g, '&paymentId='));
  if (action === 'check') details = { ...details, attemptId: params.get('attempt'), paymentId: params.get('paymentId') };
  const response = await fetch('/test-api/myfatoorah-subscription', {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...details, action, businessId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function openCheckout(url) {
  const link = new URL(url);
  if (link.origin !== 'https://demo.myfatoorah.com' || link.username || link.password) {
    throw new Error('MYFATOORAH_UNAVAILABLE');
  }
  window.location.assign(link.href);
}

export default function MyFatoorahTestCheckout({ business, date, money, returnPending, onEligible, onPaid }) {
  const { t, i18n } = useTranslation();
  const label = (key, options) => t(`myfatoorahTest.${key}`, options);
  const [eligible, setEligible] = useState(false);
  const [attempt, setAttempt] = useState(null);
  const [count, setCount] = useState(null);
  const [frequency, setFrequency] = useState(business.nextFrequency || business.frequency);
  const [code, setCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('KNET');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  const operation = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let current = true;
    checkout(returnPending ? 'check' : 'read', business.id).then(result => {
      if (current) {
        setEligible(result.eligible);
        if (result.eligible) onEligible(business.id);
        setAttempt(result.attempt);
      }
    }).catch(() => {
      // A transient provider status failure must not hide an existing attempt.
      if (returnPending) checkout('read', business.id).then(result => {
        if (current) {
          setEligible(result.eligible);
          if (result.eligible) onEligible(business.id);
          setAttempt(result.attempt);
          if (result.eligible) setError('MYFATOORAH_VERIFY_UNAVAILABLE');
        }
      }).catch(() => {});
    });
    return () => { current = false; mounted.current = false; };
  }, [business.id, returnPending, onEligible]);

  useEffect(() => {
    if (attempt?.state !== 'paid') return;
    const receiptEnd = Date.parse(attempt.periodEnd);
    const currentEnd = Date.parse(business.periodEndsAt) || 0;
    if (receiptEnd > currentEnd || (receiptEnd === currentEnd && receiptEnd > Date.now()
      && attempt.quote.count > (business.paidCapacity ?? 0))) onPaid();
  }, [attempt, business.periodEndsAt, business.paidCapacity, onPaid]);

  const state = attempt?.state;
  const unresolved = ['pending','creating','review'].includes(state);
  const periodEnd = Math.max(Date.parse(business.periodEndsAt) || 0,
    state === 'paid' ? Date.parse(attempt.periodEnd) || 0 : 0);
  const termActive = periodEnd > Date.now();
  const paidPlaces = Math.max(business.paidCapacity ?? 0,
    state === 'paid' && Date.parse(attempt.periodEnd) === periodEnd ? attempt.quote.count : 0);
  const minPlaces = Math.max(1, business.count, termActive ? paidPlaces + 1 : 1);
  const requestedPlaces = count ?? minPlaces;
  const canQuote = !unresolved && minPlaces <= 100;

  async function run(action) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const intent = termActive
        ? { kind: 'capacity', count: Number(requestedPlaces), paymentMethod }
        : { count: Number(requestedPlaces), frequency, code: code.trim(), paymentMethod };
      if (action === 'quote') {
        setQuote(await checkout('quote', business.id, intent));
        request.current = null;
      } else if (action === 'start') {
        request.current ||= crypto.randomUUID();
        const response = await checkout('start', business.id, {
          ...intent, requestId: request.current, quote, language: i18n.language,
        });
        if (!mounted.current) return;
        setAttempt(response.attempt);
        setQuote(null);
        if (response.attempt?.checkoutUrl) openCheckout(response.attempt.checkoutUrl);
      } else {
        const result = await checkout('check', business.id, { language: i18n.language });
        if (mounted.current) {
          setAttempt(result.attempt);
          if (result.attempt?.state === 'paid') setCount(null);
        }
      }
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message);
        if (action === 'start') {
          const latest = await checkout('read', business.id).catch(() => null);
          if (mounted.current && latest?.attempt) {
            setAttempt(latest.attempt);
            setQuote(null);
          }
        }
      }
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!eligible) return null;
  const capacityAttempt = attempt?.quote?.kind === 'capacity';

  return <section className="manager-billing-summary" aria-labelledby="myfatoorah-test-heading">
    <div className="manager-billing-summary-top">
      <h2 id="myfatoorah-test-heading">{label('title')}</h2>
      <span className="billing-preview-label">{label('badge')}</span>
    </div>
    <p>{label('sandbox')}</p>
    {state && <div aria-live="polite">
      <strong>{label(state === 'paid' && capacityAttempt ? 'additionalPlacesVerified' : `states.${state}`)}</strong>
      {(state === 'paid' || unresolved) && <dl className="billing-review-rows">
        <div><dt>{label('total')}</dt><dd><bdi>{money(attempt.quote.totalFils)}</bdi></dd></div>
        {capacityAttempt && <div><dt>{label('addedPlaces')}</dt><dd>{attempt.quote.addedPlaces}</dd></div>}
        <div><dt>{label(capacityAttempt ? 'totalPlaces' : 'places')}</dt><dd>{attempt.quote.count}</dd></div>
        {state === 'paid' && <>
          <div><dt>{label('periodEnd')}</dt><dd><time dateTime={attempt.periodEnd}>{date(attempt.periodEnd)}</time></dd></div>
          <div><dt>{label('receipt')}</dt><dd><bdi className="upayments-receipt">{attempt.invoiceId}</bdi></dd></div>
        </>}
      </dl>}
      {state === 'paid' && capacityAttempt && termActive && <Link className="billing-text-button" to="/dashboard/barbers">
        {label('manageBarbers')}
      </Link>}
    </div>}
    {['pending', 'creating'].includes(state) && <div className="upayments-actions">
      <button type="button" className="billing-secondary" disabled={busy} onClick={() => run('check')}>{label('check')}</button>
      {attempt.checkoutUrl && <button type="button" className="billing-secondary" disabled={busy}
        onClick={() => { try { openCheckout(attempt.checkoutUrl); } catch { setError('MYFATOORAH_UNAVAILABLE'); } }}>
        {label('resume')}
      </button>}
    </div>}
    {canQuote && termActive && <div className="upayments-capacity-heading">
      <h3>{label('addPlaces')}</h3>
      <p>{label('placesInUse', { active: business.count, paid: paidPlaces })}</p>
    </div>}
    {canQuote && <form className="subscription-form manager-billing-estimate" onSubmit={event => { event.preventDefault(); run('quote'); }}>
      <label className="subscription-field">{label('paymentMethod')}
        <select value={paymentMethod} disabled={busy} onChange={event => { setPaymentMethod(event.target.value); setQuote(null); }}>
          <option value="KNET">KNET</option><option value="CARD">{label('card')}</option>
        </select>
      </label>
      {!termActive && <label className="subscription-field">{t('billingPreview.billingFrequency')}
        <select value={frequency} disabled={busy} onChange={event => { setFrequency(event.target.value); setQuote(null); }}>
          <option value="monthly">{t('billingPreview.monthly')}</option>
          <option value="yearly">{t('billingPreview.yearly')}</option>
        </select>
      </label>}
      <label className="subscription-field">{label(termActive ? 'placesAfterPurchase' : 'places')}
        <input type="number" min={minPlaces} max={100} step={1} required value={requestedPlaces}
          disabled={busy} onChange={event => { setCount(event.target.value); setQuote(null); }}/>
      </label>
      {!termActive && <label className="subscription-field">{t('subscriptionDesign.discountCode')}
        <input value={code} maxLength={24} disabled={busy} onChange={event => { setCode(event.target.value); setQuote(null); }}/>
      </label>}
      <button type="submit" className="billing-secondary" disabled={busy}>{label(termActive ? 'reviewAdditionalPlaces' : 'review')}</button>
    </form>}
    {quote && canQuote && (quote.kind === 'capacity') === termActive && <>
      <dl className="billing-review-rows" aria-live="polite">
        {termActive ? <>
          <div><dt>{label('addedPlaces')}</dt><dd>{quote.addedPlaces}</dd></div>
          <div><dt>{label('totalPlaces')}</dt><dd>{quote.count}</dd></div>
          <div><dt>{label('periodEnd')}</dt><dd><time dateTime={quote.periodEnd}>{date(quote.periodEnd)}</time></dd></div>
        </> : <>
          <div><dt>{t('subscriptionFoundation.subtotal')}</dt><dd><bdi>{money(quote.subtotalFils)}</bdi></dd></div>
          {quote.discountFils > 0 && <div><dt>{t('subscriptionDesign.discount')}</dt><dd><bdi>{money(quote.discountFils)}</bdi></dd></div>}
        </>}
        <div><dt>{label(termActive ? 'proratedTotal' : 'total')}</dt><dd><strong><bdi>{money(quote.totalFils)}</bdi></strong></dd></div>
      </dl>
      <button type="button" className="billing-primary" disabled={busy} onClick={() => run('start')}>{label('pay')}</button>
    </>}
    {busy && <p role="status">{t('common.loading')}</p>}
    {error && <p role="alert" className="subscription-error">
      {t(`myfatoorahTest.errors.${error}`, { defaultValue: label('errors.default') })}
    </p>}
  </section>;
}
