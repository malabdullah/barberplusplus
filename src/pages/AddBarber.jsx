import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BackLink from '../components/UI/BackLink';
import InviteBarberForm from '../components/Invitations/InviteBarberForm';
import BarberForm from '../components/Forms/BarberForm';
import { barbersService } from '../services/barbers.service';
import { storageService } from '../services/storage.service';
import { getErrorMessage } from '../utils/errorMessages';
import './AddBranch.css';
import './ManagedBarbers.css';
export default function AddBarber() {
  const { t } = useTranslation();
  const { selectedBranch, services = [], reloadData } = useApp(); const navigate = useNavigate();
  const [mode, setMode] = useState('invite');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const creationId = useRef(crypto.randomUUID());
  async function create(details) {
    if (busy || !selectedBranch?.id) return;
    setBusy(true); setError(null);
    try {
      const { profilePictureFile, ...data } = details;
      let barber = await barbersService.createManaged(selectedBranch.id, { ...data, id: creationId.current });
      let imageWarning = false;
      if (profilePictureFile) {
        try {
          const avatarUrl = await storageService.uploadImage(profilePictureFile, 'barbers', barber.id);
          barber = await barbersService.update(barber.id, { avatarUrl });
        } catch { imageWarning = true; }
      }
      await reloadData();
      navigate(`/dashboard/barbers/${barber.id}/schedule`, { state: { imageWarning } });
    } catch (failure) {
      setError({ field: failure.message?.includes('PHONE_IN_USE') ? 'phone' : '', message: getErrorMessage(failure, t('common.error'), t) });
      setBusy(false);
    }
  }
  return <div className="add-branch-page invitation-form">
    <BackLink to="/dashboard/barbers" label={t('barbers.backToBarbers')} />
    <div className="add-branch-header"><h1>{t('barbers.addBarber')}</h1><p>{selectedBranch?.name}</p></div>
    <div role="tablist" aria-label={t('barbers.addBarber')} className="managed-barber-tabs">
      {['invite', 'managed'].map(value => <button key={value} role="tab" type="button" disabled={busy}
        id={`barber-${value}-tab`} aria-controls="barber-add-panel" aria-selected={mode === value}
        className={`btn ${mode === value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setMode(value); setError(null); }}>
        {t(value === 'invite' ? 'barberInvitations.invite' : 'managedBarbers.add')}
      </button>)}
    </div>
    <div role="tabpanel" id="barber-add-panel" aria-labelledby={`barber-${mode}-tab`}>
      {mode === 'invite' ? <InviteBarberForm branch={selectedBranch} onSent={result => navigate('/dashboard/barbers', { state: { invitationNotice: result.delivered ? 'sent' : 'deliveryFailed' } })} />
        : <BarberForm key={selectedBranch?.id} managed services={services.filter(item => item.branchId === selectedBranch?.id)}
          onSubmit={create} onCancel={() => navigate('/dashboard/barbers')} isSubmitting={busy} submissionError={error}
          onClearError={() => setError(null)} disabledReason={!selectedBranch ? t('barberInvitations.errors.SHOP_REQUIRED') : ''} />}
    </div>
  </div>;
}
