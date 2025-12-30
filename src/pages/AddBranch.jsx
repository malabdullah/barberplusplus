import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import BranchForm from '../components/Forms/BranchForm';
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
      navigate('/branches');
    } catch (err) {
      console.error('Error creating branch:', err);
      setError(err.message || t('errors.createBranchFailed'));
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/branches');
  };

  return (
    <div className="add-branch-page">
      <Link to="/branches" className="back-link animate-fade-in">
        <ArrowLeft size={18} strokeWidth={1.5} />
        {t('branches.backToBranches')}
      </Link>

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
