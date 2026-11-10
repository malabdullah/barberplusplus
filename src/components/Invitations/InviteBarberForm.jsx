import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { barberInvitationsService as api } from '../../services/barberInvitations.service';
import ConfirmDialog from '../UI/ConfirmDialog';
import '../Forms/Forms.css';
import './Invitations.css';

export default function InviteBarberForm({ branch: selectedBranch, managedBarberId, onSent }) {
  const { t } = useTranslation();
  const tr = (key, options) => t('barberInvitations.' + key, options);
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false);
  const currentBranch = useRef(selectedBranch?.id);
  currentBranch.current = selectedBranch?.id;
  useEffect(() => { setConfirm(false); setError(''); }, [selectedBranch?.id]);
  const send = async confirmed => {
    const branchId = selectedBranch?.id;
    if (busy) return; setError(''); setBusy(true);
    try {
      if (!branchId) throw new Error('SHOP_REQUIRED');
      if (!confirmed) {
        const checked = await api.check(branchId, email, ...(managedBarberId ? [managedBarberId] : []));
        if (currentBranch.current !== branchId) return;
        if (checked.kind === 'customer') { setConfirm(true); return; }
      }
      const result = await api.send(branchId, email, confirmed, ...(managedBarberId ? [managedBarberId] : []));
      if (currentBranch.current !== branchId) return;
      onSent(result);
    } catch (e) { setError(e.message); setConfirm(false); } finally { setBusy(false); }
  };
  return <>
    {(error || !selectedBranch) && <p className="error-banner" role="alert">{tr('errors.' + (error || 'SHOP_REQUIRED'))}</p>}
    <form className="form" onSubmit={e => { e.preventDefault(); send(false); }}>
      <div className="form-group"><label className="form-label" htmlFor="invite-email">{t('common.email')}</label><input id="invite-email" className="form-input" type="email" dir="ltr" value={email} onChange={e => { setEmail(e.target.value); setError(''); setConfirm(false); }} maxLength={254} autoComplete="email" disabled={busy} required /></div>
      <button className="btn btn-primary" type="submit" disabled={busy || !selectedBranch}>{tr(busy ? 'sending' : 'send')}</button>
    </form>
    <ConfirmDialog isOpen={confirm} onClose={() => !busy && setConfirm(false)} onConfirm={() => send(true)} title={tr('existingCustomer')} message={tr('customerConfirm', { email: email.trim() })} confirmText={tr('send')} cancelText={t('common.cancel')} variant="warning" />
  </>;
}
