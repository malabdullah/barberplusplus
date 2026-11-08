import React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { barberConfirmationService } from '../../services/barberConfirmation.service';
import './AutoConfirmBookings.css';

export default function AutoConfirmBookings({ barberId }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ value: true, loading: true, saving: false, error: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState(previous => ({ ...previous, loading: true, error: false }));
    barberConfirmationService.read(barberId).then(value => {
      if (active) setState({ value, loading: false, saving: false, error: false });
    }).catch(() => { if (active) setState(previous => ({ ...previous, loading: true, error: true })); });
    return () => { active = false; };
  }, [barberId, retry]);
  async function toggle() {
    if (state.loading || state.saving) return;
    setState(previous => ({ ...previous, saving: true, error: false }));
    try {
      const value = await barberConfirmationService.save(barberId, !state.value);
      setState({ value, loading: false, saving: false, error: false });
    } catch {
      setState(previous => ({ ...previous, saving: false, error: true }));
    }
  }
  return <section className="auto-confirm-card" aria-busy={state.loading || state.saving}>
    <div className="auto-confirm-row">
      <div><h2>{t('autoConfirmation.label')}</h2><p>{t(state.value ? 'autoConfirmation.on' : 'autoConfirmation.off')}</p></div>
      <button type="button" role="switch" aria-label={t('autoConfirmation.label')} aria-checked={state.value}
        className={`toggle ${state.value ? 'active' : ''}`} disabled={state.loading || state.saving} onClick={toggle}>
        <span className="toggle-thumb" />
      </button>
    </div>
    {state.error && <p role="alert">{t('autoConfirmation.failed')} <button className="btn btn-secondary" type="button" onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button></p>}
  </section>;
}
