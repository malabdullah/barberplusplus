import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { appConfig } from '../../lib/runtimeConfig';

export const showUPaymentsTest = appConfig.environment === 'cloud-test'
  && appConfig.cloudTestProjectRef === 'qvkucvcjmojjbphlzlks'
  && appConfig.appUrl === 'https://barber-test.alabdullah-cs.workers.dev';

async function checkout(action, businessId, details) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('UPAYMENTS_FORBIDDEN');
  const response = await fetch('/test-api/upayments-subscription', {
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
  if (link.origin !== 'https://sandbox.upayments.com' || link.username || link.password) {
    throw new Error('UPAYMENTS_UNAVAILABLE');
  }
  window.location.assign(link.href);
}

export default function UPaymentsTestCheckout({ business, date, money, returnPending, onEligible, onPaid }) {
  const { t, i18n } = useTranslation();
  const label = key => t(`upaymentsTest.${key}`);
  const [eligible, setEligible] = useState(false);
  const [attempt, setAttempt] = useState(null);
  const [count, setCount] = useState(Math.max(1, business.count));
  const [frequency, setFrequency] = useState(business.nextFrequency || business.frequency);
  const [code, setCode] = useState('');
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
          if (result.eligible) setError('UPAYMENTS_VERIFY_UNAVAILABLE');
        }
      }).catch(() => {});
    });
    return () => { current = false; mounted.current = false; };
  }, [business.id, returnPending, onEligible]);

  useEffect(() => {
    if (attempt?.state === 'paid' && Date.parse(attempt.periodEnd) > (Date.parse(business.periodEndsAt) || 0)) onPaid();
  }, [attempt, business.periodEndsAt, onPaid]);

  async function run(action) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const intent = { count: Number(count), frequency, code: code.trim() };
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
        if (mounted.current) setAttempt(result.attempt);
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
  const state = attempt?.state;
  const unresolved = ['pending','creating','review'].includes(state);
  const termActive = state === 'paid' && new Date(attempt.periodEnd) > new Date()
    || business.periodEndsAt && new Date(business.periodEndsAt) > new Date();

  return <section className="manager-billing-summary" aria-labelledby="upayments-test-heading">
    <div className="manager-billing-summary-top">
      <h2 id="upayments-test-heading">{label('title')}</h2>
      <span className="billing-preview-label">{label('badge')}</span>
    </div>
    <p>{label('sandbox')}</p>
    {state && <div aria-live="polite">
      <strong>{label(`states.${state}`)}</strong>
      {(state === 'paid' || unresolved) && <dl className="billing-review-rows">
        <div><dt>{label('total')}</dt><dd><bdi>{money(attempt.quote.totalFils)}</bdi></dd></div>
        <div><dt>{label('places')}</dt><dd>{attempt.quote.count}</dd></div>
        {state === 'paid' && <>
          <div><dt>{label('periodEnd')}</dt><dd><time dateTime={attempt.periodEnd}>{date(attempt.periodEnd)}</time></dd></div>
          <div><dt>{label('receipt')}</dt><dd><bdi className="upayments-receipt">{attempt.invoiceId}</bdi></dd></div>
        </>}
      </dl>}
    </div>}
    {['pending', 'creating'].includes(state) && <div className="upayments-actions">
      <button type="button" className="billing-secondary" disabled={busy} onClick={() => run('check')}>{label('check')}</button>
      {attempt.checkoutUrl && <button type="button" className="billing-secondary" disabled={busy}
        onClick={() => { try { openCheckout(attempt.checkoutUrl); } catch { setError('UPAYMENTS_UNAVAILABLE'); } }}>
        {label('resume')}
      </button>}
    </div>}
    {!unresolved && !termActive && <form className="subscription-form manager-billing-estimate" onSubmit={event => { event.preventDefault(); run('quote'); }}>
      <label className="subscription-field">{t('billingPreview.billingFrequency')}
        <select value={frequency} disabled={busy} onChange={event => { setFrequency(event.target.value); setQuote(null); }}>
          <option value="monthly">{t('billingPreview.monthly')}</option>
          <option value="yearly">{t('billingPreview.yearly')}</option>
        </select>
      </label>
      <label className="subscription-field">{label('places')}
        <input type="number" min={Math.max(1, business.count)} max={100} step={1} required value={count}
          disabled={busy} onChange={event => { setCount(event.target.value); setQuote(null); }}/>
      </label>
      <label className="subscription-field">{t('subscriptionDesign.discountCode')}
        <input value={code} maxLength={24} disabled={busy} onChange={event => { setCode(event.target.value); setQuote(null); }}/>
      </label>
      <button type="submit" className="billing-secondary" disabled={busy}>{label('review')}</button>
    </form>}
    {quote && !unresolved && !termActive && <>
      <dl className="billing-review-rows" aria-live="polite">
        <div><dt>{t('subscriptionFoundation.subtotal')}</dt><dd><bdi>{money(quote.subtotalFils)}</bdi></dd></div>
        {quote.discountFils > 0 && <div><dt>{t('subscriptionDesign.discount')}</dt><dd><bdi>{money(quote.discountFils)}</bdi></dd></div>}
        <div><dt>{label('total')}</dt><dd><strong><bdi>{money(quote.totalFils)}</bdi></strong></dd></div>
      </dl>
      <button type="button" className="billing-primary" disabled={busy} onClick={() => run('start')}>{label('pay')}</button>
    </>}
    {busy && <p role="status">{t('common.loading')}</p>}
    {error && <p role="alert" className="subscription-error">
      {t(`upaymentsTest.errors.${error}`, { defaultValue: label('errors.default') })}
    </p>}
  </section>;
}
