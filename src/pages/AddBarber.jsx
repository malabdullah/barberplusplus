import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BarberForm from '../components/Forms/BarberForm';
import BackLink from '../components/UI/BackLink';
import { logErrorDev } from '../utils/security';
import { getErrorMessage } from '../utils/errorMessages';
import './AddBranch.css';

export default function AddBarber() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addBarber, selectedBranch, selectedBranchId, branchServices } = useApp();
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasShop = Boolean(selectedBranch?.id && selectedBranch.id === selectedBranchId);

  const handleSubmit = async (data) => {
    if (isSubmitting) return;
    if (!hasShop) { setError({ message: t('barbers.selectShopFirst') }); return; }
    setError(null);
    setIsSubmitting(true);
    try {
      await addBarber(data);
      navigate('/dashboard/barbers');
    } catch (err) {
      logErrorDev('Error creating barber:', err);
      setError({ message: err.message === 'SHOP_REQUIRED' ? t('barbers.selectShopFirst') : getErrorMessage(err, t('errors.createBarberFailed'), t), field: /PHONE_IN_USE/.test(err.message) ? 'phone' : undefined });
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard/barbers');
  };

  return (
    <div className="add-branch-page">
      <BackLink to="/dashboard/barbers" label={t('barbers.backToBarbers')} className="animate-fade-in" />

      <div className="add-branch-header animate-fade-in-up">
        <h1>{t('barbers.addNewBarber')}</h1>
        <p>{t('barbers.addTeamMember')} {selectedBranch?.name}</p>
      </div>

      <div className="add-branch-form-container animate-fade-in-up stagger-1">
        <BarberForm
          barber={null}
          services={branchServices}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
          submissionError={error}
          onClearError={() => setError(null)}
          disabledReason={hasShop ? '' : t('barbers.selectShopFirst')}
        />
      </div>
    </div>
  );
}
