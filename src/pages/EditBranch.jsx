import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BranchForm from '../components/Forms/BranchForm';
import BackLink from '../components/UI/BackLink';
import './AddBranch.css';

export default function EditBranch() {
  const { t } = useTranslation();
  const { branchId } = useParams();
  const navigate = useNavigate();
  const { branches, updateBranch } = useApp();

  const branch = branches.find((b) => b.id === branchId);

  const handleSubmit = (data) => {
    updateBranch(branchId, data);
    navigate('/dashboard/branches');
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
        <BranchForm
          branch={branch}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}
