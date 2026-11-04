import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bookingPolicyService } from '../../services/bookingPolicy.service';
import './BookingPolicy.css';

export default function BookingPolicySettings({ branchId = null }) {
  const { t } = useTranslation();
  const id = useId();
  const tr = (key, options) => t(`bookingPolicy.${key}`, options);
  const [settings, setSettings] = useState(null);
  const [fields, setFields] = useState({ cancel: '', reschedule: '', barber: false });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setSettings(null); setError(''); setMessage('');
    bookingPolicyService.manage(branchId).then(data => {
      if (!active) return;
      setSettings(data);
      setFields({
        cancel: String((branchId ? data.cancel_override : data.default_cancel_minutes) ?? ''),
        reschedule: String((branchId ? data.reschedule_override : data.default_reschedule_minutes) ?? ''),
        barber: data.barber_can_cancel,
      });
    }).catch(() => { if (active) setError('loadError'); });
    return () => { active = false; };
  }, [branchId, attempt]);

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const data = await bookingPolicyService.manage(branchId, {
        cancel_minutes: fields.cancel === '' ? null : Number(fields.cancel),
        reschedule_minutes: fields.reschedule === '' ? null : Number(fields.reschedule),
        barber_can_cancel: fields.barber,
      });
      setSettings(data); setMessage('saved');
    } catch { setError('saveError'); }
    finally { setSaving(false); }
  }

  return <section className="booking-policy-settings" aria-labelledby={id}>
    <h2 id={id}>{tr(branchId ? 'shopTitle' : 'adminTitle')}</h2>
    <p>{tr(branchId ? 'shopHint' : 'adminHint')}</p>
    {error && <p role="alert">{tr(error)}</p>}
    {message && <p role="status">{tr(message)}</p>}
    {!settings ? error ? <button className="btn btn-secondary" type="button" onClick={() => setAttempt(value => value + 1)}>{t('common.retry', { defaultValue: 'Try again' })}</button> : <p role="status">{t('common.loading')}</p> : <form onSubmit={save}>
      <div className="booking-policy-fields">
        {[['cancel', 'default_cancel_minutes'], ['reschedule', 'default_reschedule_minutes']].map(([key, fallback]) => <label key={key}>
          {tr(key)}
          <input className="form-input" type="number" min="0" max="525600" step="1" required={!branchId} disabled={saving}
            value={fields[key]} onChange={event => setFields({ ...fields, [key]: event.target.value })}
            placeholder={branchId ? String(settings[fallback]) : undefined} />
        </label>)}
      </div>
      {branchId && <label className="booking-policy-toggle"><input type="checkbox" checked={fields.barber} disabled={saving} onChange={event => setFields({ ...fields, barber: event.target.checked })} />{tr('barberCancel')}</label>}
      <button className="btn btn-primary" type="submit" disabled={saving}>{tr('save')}</button>
    </form>}
  </section>;
}
