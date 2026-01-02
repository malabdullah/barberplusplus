import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import BarberForm from '../components/Forms/BarberForm';
import './AddBranch.css';

export default function AddBarber() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addBarber, selectedBranch, branchServices } = useApp();
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await addBarber(data);
      navigate('/dashboard/barbers');
    } catch (err) {
      console.error('Error creating barber:', err);
      setError(err.message || t('errors.createBarberFailed'));
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard/barbers');
  };

  return (
    <div className="add-branch-page">
      <Link to="/dashboard/barbers" className="back-link animate-fade-in">
        <ArrowLeft size={18} strokeWidth={1.5} />
        {t('barbers.backToBarbers')}
      </Link>

      <div className="add-branch-header animate-fade-in-up">
        <h1>{t('barbers.addNewBarber')}</h1>
        <p>{t('barbers.addTeamMember')} {selectedBranch?.name}</p>
      </div>

      {error && (
        <div className="error-banner animate-fade-in">
          {error}
        </div>
      )}

      <div className="add-branch-form-container animate-fade-in-up stagger-1">
        <BarberForm
          barber={null}
          services={branchServices}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
