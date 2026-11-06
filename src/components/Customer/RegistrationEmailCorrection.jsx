import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registrationService } from '../../services/registration.service';

export default function RegistrationEmailCorrection({ email, audience = 'customer', returnTo, disabled, onCorrected, onBusy }) {
  const { t } = useTranslation();
  const tr = key => t(`accountEmail.${key}`);
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); if (busy || disabled) return;
    setBusy(true); onBusy?.(true); setError('');
    try {
      const result = await registrationService.correct({ email, newEmail, password, audience, returnTo });
      setPassword(''); setEditing(false); onCorrected(result);
    } catch (failure) {
      setError(['EMAIL_IN_USE','REGISTRATION_CANNOT_CORRECT','RATE_LIMITED','INVALID_DETAILS'].includes(failure.message) ? failure.message : 'UNAVAILABLE');
    } finally { setBusy(false); onBusy?.(false); }
  };
  if (!editing) return <button type="button" className="cb-text-button signup-correct-email" disabled={disabled} onClick={() => { setNewEmail(email); setEditing(true); setError(''); }}>{tr('correct')}</button>;
  return <form className="registration-email-correction" onSubmit={submit}>
    <p className="cb-helper">{tr('correctionHint')}</p>
    <label className="cb-field-label" htmlFor={`correct-email-${audience}`}>{tr('newEmail')}</label>
    <input className="cb-input" id={`correct-email-${audience}`} type="email" dir="ltr" autoComplete="email" value={newEmail} maxLength={254} onChange={event => setNewEmail(event.target.value)} disabled={busy || disabled} required />
    <label className="cb-field-label" htmlFor={`correct-password-${audience}`}>{tr('registrationPassword')}</label>
    <input className="cb-input" id={`correct-password-${audience}`} type="password" autoComplete="current-password" value={password} maxLength={72} onChange={event => setPassword(event.target.value)} disabled={busy || disabled} required />
    {error && <p className="cb-alert" role="alert">{tr(`errors.${error}`)}</p>}
    <div className="ca-profile-buttons"><button className="cb-primary" type="submit" disabled={busy || disabled}>{tr(busy ? 'correcting' : 'saveCorrection')}</button><button className="cb-secondary" type="button" disabled={busy} onClick={() => { setPassword(''); setEditing(false); }}>{t('common.cancel')}</button></div>
  </form>;
}
