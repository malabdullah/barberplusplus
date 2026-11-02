import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BranchForm from '../components/Forms/BranchForm';
import BackLink from '../components/UI/BackLink';
import { getErrorMessage } from '../utils/errorMessages';
import './AddBranch.css';

export default function EditBranch() {
  const { t } = useTranslation();
  const { branchId } = useParams();
  const navigate = useNavigate();
  const { branches, updateBranch } = useApp();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const branch = branches.find((b) => b.id === branchId);

  const handleSubmit = async (data) => {
    if (isSubmitting) return;
    setIsSubmitting(true); setErrorMessage('');
    try { await updateBranch(branchId, data); navigate('/dashboard/branches'); }
    catch (error) { setErrorMessage(getErrorMessage(error, t('common.error'), t)); }
    finally { setIsSubmitting(false); }
  };

  const handleCancel = () => {
    navigate('/dashboard/branches');
  };

  if (!branch) {
    return (
      <div className="edit-branch-page">
        <BackLink to="/dashboard/branches" label={t('branches.backToBranches')} className="animate-fade-in" />
        <div className="not-found">
          <h2>{t('branches.branchNotFound')}</h2>
          <Link to="/dashboard/branches" className="btn btn-primary">
            {t('branches.backToBranches')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-branch-page">
      <BackLink to="/dashboard/branches" label={t('branches.backToBranches')} className="animate-fade-in" />

      <div className="edit-branch-header animate-fade-in-up">
        <h1>{t('branches.editBranch')}</h1>
        <p>{t('branches.updateDetails')} {branch.name}</p>
      </div>

      <div className="edit-branch-form-container animate-fade-in-up stagger-1">
        {errorMessage && <p className="error-banner" role="alert">{errorMessage}</p>}
        <BranchForm
          branch={branch}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
