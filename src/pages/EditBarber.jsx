import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BarberForm from '../components/Forms/BarberForm';
import BackLink from '../components/UI/BackLink';
import { logErrorDev } from '../utils/security';
import { getErrorMessage } from '../utils/errorMessages';
import './AddBranch.css';
import { setupReturn } from '../utils/shopSetup';

export default function EditBarber() {
  const { t } = useTranslation();
  const { barberId } = useParams();
  const navigate = useNavigate();
  const { barbers, services, branches, user, updateBarber } = useApp();
  const { search } = useLocation();
  const setup = setupReturn(search, branches, user?.id);
  const backTo = setup?.path || '/dashboard/barbers';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const barber = barbers.find((b) => b.id === barberId && branches.some(shop => shop.id === b.branchId && shop.managerId === user?.id));
  const branchServices = services.filter(service => service.branchId === barber?.branchId);

  const handleSubmit = async (data) => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await updateBarber(barberId, data);
      navigate(backTo);
    } catch (error) {
      logErrorDev('Error updating barber:', error);
      setErrorMessage(getErrorMessage(error, t('common.error'), t));
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(backTo);
  };

  if (barber?.managerChair) return <Navigate to="/dashboard/my-chair?view=profile" replace />;

  if (!barber) {
    return (
      <div className="edit-branch-page">
        <BackLink to={backTo} label={t(setup ? 'shopSetup.back' : 'barbers.backToBarbers')} className="animate-fade-in" />
        <div className="not-found">
          <h2>{t('barbers.barberNotFound')}</h2>
          <Link to="/dashboard/barbers" className="btn btn-primary">
            {t('barbers.backToBarbers')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-branch-page">
      <BackLink to={backTo} label={t(setup ? 'shopSetup.back' : 'barbers.backToBarbers')} className="animate-fade-in" />

      <div className="edit-branch-header animate-fade-in-up">
        <h1>{t('barbers.editBarber')}</h1>
        <p>{t('barbers.updateProfile')} {barber.name}</p>
      </div>

      <div className="edit-branch-form-container animate-fade-in-up stagger-1">
        {errorMessage && <p className="error-banner" role="alert">{errorMessage}</p>}
        <BarberForm
          barber={barber}
          services={branchServices}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
