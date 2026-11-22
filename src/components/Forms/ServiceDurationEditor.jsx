import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function ServiceDurationEditor({ barber, services }) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState(barber?.serviceDurations || {});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setValues(barber?.serviceDurations || {}); }, [barber?.id, barber?.serviceDurations]);
  async function save(id, reset = false) {
    const duration = reset ? null : Number(values[id]);
    if (!reset && (!Number.isInteger(duration) || duration < 5 || duration > 480)) { setError(t('serviceDurations.invalid')); return; }
    setBusy(id); setError('');
    try {
      const { saveServiceDuration } = await import('../../services/serviceDurations.service');
      const data = await saveServiceDuration(barber.id, id, duration);
      setValues(data);
      window.dispatchEvent(new CustomEvent('barber-duration-changed', { detail: { id: barber.id, serviceDurations: data } }));
    } catch { setError(t('common.error')); } finally { setBusy(''); }
  }
  return <section className="form-section"><h3>{t('serviceDurations.title')}</h3>
    {services.filter(service => barber?.services?.includes(service.id) && service.status !== 'inactive').map(service => <div key={service.id} className="service-duration-row">
      <label htmlFor={`duration-${barber.id}-${service.id}`}>{i18n.language.startsWith('ar') ? service.nameAr || service.name : service.name}</label>
      <input className="form-input" id={`duration-${barber.id}-${service.id}`} type="number" min="5" max="480" step="1" value={values[service.id] ?? service.duration} disabled={Boolean(busy)} onChange={event => setValues(previous => ({ ...previous, [service.id]: event.target.value }))} />
      <span>{t('common.min')}</span><button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => save(service.id)}>{t('common.save')}</button>
      <button className="btn btn-ghost" type="button" disabled={Boolean(busy) || values[service.id] == null} onClick={() => save(service.id, true)}>{t('serviceDurations.reset')}</button>
    </div>)}{error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
