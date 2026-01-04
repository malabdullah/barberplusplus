import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BarberForm from '../components/Forms/BarberForm';
import BackLink from '../components/UI/BackLink';
import { logErrorDev } from '../utils/security';
import './AddBranch.css';

export default function EditBarber() {
  const { t } = useTranslation();
  const { barberId } = useParams();
  const navigate = useNavigate();
  const { branchBarbers, branchServices, updateBarber } = useApp();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const barber = branchBarbers.find((b) => b.id === barberId);

  const handleSubmit = async (data) => {
    setIsSubmitting(true);
    try {
      await updateBarber(barberId, data);
      navigate('/dashboard/barbers');
    } catch (error) {
      logErrorDev('Error updating barber:', error);
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard/barbers');
  };

  if (!barber) {
    return (
      <div className="edit-branch-page">
        <BackLink to="/dashboard/barbers" label={t('barbers.backToBarbers')} className="animate-fade-in" />
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
      <BackLink to="/dashboard/barbers" label={t('barbers.backToBarbers')} className="animate-fade-in" />

      <div className="edit-branch-header animate-fade-in-up">
        <h1>{t('barbers.editBarber')}</h1>
        <p>{t('barbers.updateProfile')} {barber.name}</p>
      </div>

      <div className="edit-branch-form-container animate-fade-in-up stagger-1">
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
