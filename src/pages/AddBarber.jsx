import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BackLink from '../components/UI/BackLink';
import InviteBarberForm from '../components/Invitations/InviteBarberForm';
import './AddBranch.css';
export default function AddBarber() {
  const { t } = useTranslation();
  const { selectedBranch } = useApp(); const navigate = useNavigate();
  return <div className="add-branch-page invitation-form">
    <BackLink to="/dashboard/barbers" label={t('barbers.backToBarbers')} />
    <div className="add-branch-header"><h1>{t('barberInvitations.invite')}</h1><p>{selectedBranch?.name}</p></div>
    <InviteBarberForm branch={selectedBranch} onSent={result => navigate('/dashboard/barbers', { state: { invitationNotice: result.delivered ? 'sent' : 'deliveryFailed' } })} />
  </div>;
}
