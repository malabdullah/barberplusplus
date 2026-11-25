import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BackLink from '../components/UI/BackLink';
import InviteBarberForm from '../components/Invitations/InviteBarberForm';
import BarberForm from '../components/Forms/BarberForm';
import { barbersService } from '../services/barbers.service';
import { storageService } from '../services/storage.service';
import { getErrorMessage } from '../utils/errorMessages';
import { setupReturn, setupActionUrl } from '../utils/shopSetup';
import './AddBranch.css';
import './ManagedBarbers.css';
export default function AddBarber() {
  const { t } = useTranslation();
  const { selectedBranch: currentShop, branches = [], user, setSelectedBranchId, services = [], reloadData } = useApp(); const navigate = useNavigate();
  const { search } = useLocation();
  const setup = setupReturn(search, branches, user?.id);
  const invalidSetup = new URLSearchParams(search).has('setup') && !setup;
  const selectedBranch = setup ? branches.find(shop => shop.id === setup.id) : currentShop;
  const backTo = setup?.path || '/dashboard/barbers';
  const [mode, setMode] = useState(() => new URLSearchParams(search).get('mode') === 'managed' ? 'managed' : 'invite');
  useEffect(() => { if (setup && currentShop?.id !== setup.id) setSelectedBranchId(setup.id); }, [setup?.id, currentShop?.id, setSelectedBranchId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const creationId = useRef(crypto.randomUUID());
  async function create(details) {
    if (busy || invalidSetup || !selectedBranch?.id) return;
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
      const schedule = `/dashboard/barbers/${barber.id}/schedule`;
      navigate(setup ? setupActionUrl(schedule, setup.id, 'hours') : schedule, { state: { imageWarning } });
    } catch (failure) {
      setError({ field: failure.message?.includes('PHONE_IN_USE') ? 'phone' : '', message: getErrorMessage(failure, t('common.error'), t) });
      setBusy(false);
    }
  }
  if (invalidSetup) return <div className="add-branch-page"><BackLink to="/dashboard/setup" label={t('shopSetup.back')} /><p role="alert">{t('shopSetup.notFound')}</p></div>;
  return <div className="add-branch-page invitation-form">
    <BackLink to={backTo} label={t(setup ? 'shopSetup.back' : 'barbers.backToBarbers')} />
    <div className="add-branch-header"><h1>{t('barbers.addBarber')}</h1><p>{selectedBranch?.name}</p></div>
    <div role="tablist" aria-label={t('barbers.addBarber')} className="managed-barber-tabs">
      {['invite', 'managed'].map(value => <button key={value} role="tab" type="button" disabled={busy}
        id={`barber-${value}-tab`} aria-controls="barber-add-panel" aria-selected={mode === value}
        className={`btn ${mode === value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setMode(value); setError(null); }}>
        {t(value === 'invite' ? 'barberInvitations.invite' : 'managedBarbers.add')}
      </button>)}
    </div>
    <div role="tabpanel" id="barber-add-panel" aria-labelledby={`barber-${mode}-tab`}>
      {mode === 'invite' ? <InviteBarberForm branch={selectedBranch} onSent={result => navigate(backTo, { state: { invitationNotice: result.delivered ? 'sent' : 'deliveryFailed' } })} />
        : selectedBranch ? <BarberForm key={selectedBranch.id} managed services={services.filter(item => item.branchId === selectedBranch.id)}
          onSubmit={create} onCancel={() => navigate(backTo)} isSubmitting={busy} submissionError={error}
          onClearError={() => setError(null)} /> : <p role="alert">{t('barberInvitations.errors.SHOP_REQUIRED')}</p>}
    </div>
  </div>;
}
