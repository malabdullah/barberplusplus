import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BranchForm from '../components/Forms/BranchForm';
import BackLink from '../components/UI/BackLink';
import { getErrorMessage, logErrorSafely } from '../utils/errorMessages';
import './AddBranch.css';

export default function AddBranch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addBranch } = useApp();
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await addBranch(data);
      navigate('/dashboard/branches');
    } catch (err) {
      logErrorSafely(err, 'AddBranch');
      setError(getErrorMessage(err, t('errors.createBranchFailed')));
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard/branches');
  };

  return (
    <div className="add-branch-page">
      <BackLink to="/dashboard/branches" label={t('branches.backToBranches')} className="animate-fade-in" />

      <div className="add-branch-header animate-fade-in-up">
        <h1>{t('branches.addNewBranch')}</h1>
        <p>{t('branches.createNewLocation')}</p>
      </div>

      {error && (
        <div className="error-banner animate-fade-in">
          {error}
        </div>
      )}

      <div className="add-branch-form-container animate-fade-in-up stagger-1">
        <BranchForm
          branch={null}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
