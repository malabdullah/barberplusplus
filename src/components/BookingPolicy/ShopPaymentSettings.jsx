import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bookingPolicyService } from '../../services/bookingPolicy.service';
import './BookingPolicy.css';

const methods = ['at_shop', 'online', 'both'];

export default function ShopPaymentSettings({ branchId }) {
  const { t } = useTranslation();
  const id = useId();
  const [settings, setSettings] = useState(null);
  const [method, setMethod] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    bookingPolicyService.paymentMethods(branchId).then(data => {
      if (active) {
        setSettings(data);
        setMethod(data.method);
        setFeedback('');
      }
    }).catch(() => { if (active) setFeedback('loadError'); });
    return () => { active = false; };
  }, [branchId, attempt]);

  async function save(event) {
    event.preventDefault();
    if (!settings || saving || method === settings.method) return;
    setSaving(true);
    setFeedback('');
    try {
      const data = await bookingPolicyService.paymentMethods(branchId, method);
      setSettings(data);
      setMethod(data.method);
      setFeedback('saved');
    } catch {
      setFeedback('saveError');
    } finally {
      setSaving(false);
    }
  }

  return <section className="booking-policy-settings" aria-labelledby={id}>
    <h2 id={id}>{t('shopPayment.title')}</h2>
    {settings && !settings.onlineAvailable && <p>{t('shopPayment.notEnabled')}</p>}
    {feedback && <p role={feedback === 'saved' ? 'status' : 'alert'}>{t(`shopPayment.${feedback}`)}</p>}
    {settings ? <form onSubmit={save}>
      <div className="booking-policy-fields"><label>
        {t('shopPayment.method')}
        <select className="form-input" value={method} disabled={saving} onChange={event => {
          setMethod(event.target.value); setFeedback('');
        }}>
          {methods.map(option => <option key={option} value={option} disabled={option !== 'at_shop' && !settings.onlineAvailable}>
            {t(`shopPayment.${option}`)}
          </option>)}
        </select>
      </label></div>
      <button className="btn btn-primary" type="submit" disabled={saving || method === settings.method}>{t('shopPayment.save')}</button>
    </form> : feedback ? <button className="btn btn-secondary" type="button" onClick={() => {
      setFeedback(''); setAttempt(value => value + 1);
    }}>{t('common.retry')}</button> : <p role="status">{t('common.loading')}</p>}
  </section>;
}
