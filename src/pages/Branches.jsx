import React, { useState, memo, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  Plus,
  MapPin,
  Phone,
  Mail,
  Users,
  Scissors,
  Clock,
  Pencil,
  Trash2,
  Eye,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import ConfirmDialog from '../components/UI/ConfirmDialog';
import './Branches.css';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const BranchCard = memo(function BranchCard({ branch, barberCount, serviceCount, onDelete, t }) {
  const navigate = useNavigate();
  const todayKey = DAY_KEYS[new Date().getDay()];
  const todayHours = branch.openingHours?.[todayKey];

  // Utility function for formatting hours
  const formatHours = (hours) => {
    if (!hours?.open || !hours?.close) return t('availability.closed');
    return `${hours.open} - ${hours.close}`;
  };

  return (
    <div className="branch-card animate-fade-in-up">
      <div className="branch-card-header">
        <div className="branch-card-icon">
          {branch.imageUrl ? (
            <img src={branch.imageUrl} alt={branch.name} />
          ) : (
            <Building2 size={24} strokeWidth={1.5} />
          )}
        </div>
        <div className={`branch-status ${branch.status}`}>
          {branch.status === 'active' ? t('availability.open') : t('availability.closed')}
        </div>
      </div>

      <Link to={`/dashboard/branches/${branch.id}`} className="branch-card-content">
        <h3 className="branch-card-name">{branch.name}</h3>

        <div className="branch-card-info">
          {(branch.areaName || branch.governorateName) && (
            <div className="branch-info-item">
              <MapPin size={14} strokeWidth={1.5} />
              <span>{[branch.areaName, branch.governorateName].filter(Boolean).join(', ')}</span>
            </div>
          )}
          {branch.phone && (
            <div className="branch-info-item">
              <Phone size={14} strokeWidth={1.5} />
              <span>{branch.phone}</span>
            </div>
          )}
          {branch.email && (
            <div className="branch-info-item">
              <Mail size={14} strokeWidth={1.5} />
              <span>{branch.email}</span>
            </div>
          )}
        </div>

        <div className="branch-card-stats">
          <div className="branch-stat">
            <Users size={16} strokeWidth={1.5} />
            <span>{barberCount} {t('nav.barbers')}</span>
          </div>
          <div className="branch-stat">
            <Scissors size={16} strokeWidth={1.5} />
            <span>{serviceCount} {t('nav.services')}</span>
          </div>
        </div>
      </Link>

      <div className="branch-card-footer">
        <div className="branch-hours">
          <Clock size={14} strokeWidth={1.5} />
          <span>{t('common.today')}: {formatHours(todayHours || {})}</span>
        </div>
        <div className="branch-actions">
          <button
            className="action-btn"
            onClick={() => navigate(`/dashboard/branches/${branch.id}/edit`)}
            title={t('branches.editBranch')}
          >
            <Pencil size={16} strokeWidth={1.5} />
          </button>
          <button
            className="action-btn"
            onClick={() => navigate(`/dashboard/branches/${branch.id}`)}
            title={t('branches.branchDetails')}
          >
            <Eye size={16} strokeWidth={1.5} />
          </button>
          <button
            className="action-btn danger"
            onClick={() => onDelete(branch)}
            title={t('branches.deleteBranch')}
          >
            <Trash2 size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default function Branches() {
  const { t } = useTranslation();
  const { branches, barbers, services, deleteBranch } = useApp();
  const [deletingBranch, setDeletingBranch] = useState(null);

  // Pre-compute counts per branch to avoid O(n*m) filtering in render loop
  const barberCountByBranch = useMemo(() => {
    const map = {};
    barbers.forEach(b => {
      map[b.branchId] = (map[b.branchId] || 0) + 1;
    });
    return map;
  }, [barbers]);

  const serviceCountByBranch = useMemo(() => {
    const map = {};
    services.forEach(s => {
      map[s.branchId] = (map[s.branchId] || 0) + 1;
    });
    return map;
  }, [services]);

  const handleDeleteBranch = useCallback((branch) => {
    setDeletingBranch(branch);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deletingBranch) {
      deleteBranch(deletingBranch.id);
      setDeletingBranch(null);
    }
  }, [deletingBranch, deleteBranch]);

  return (
    <div className="branches-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">{t('branches.yourBranches')}</h2>
          <p className="page-description">
            {t('branches.subtitle')}
          </p>
        </div>
        <Link to="/dashboard/branches/new" className="btn btn-primary">
          <Plus size={18} strokeWidth={2} />
          {t('branches.addBranch')}
        </Link>
      </div>

      {branches.length > 0 ? (
        <div className="branches-grid">
          {branches.map((branch, index) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              barberCount={barberCountByBranch[branch.id] || 0}
              serviceCount={serviceCountByBranch[branch.id] || 0}
              onDelete={handleDeleteBranch}
              t={t}
            />
          ))}

          {/* Add Branch Card */}
          <Link to="/dashboard/branches/new" className="add-branch-card animate-fade-in-up">
            <div className="add-branch-icon">
              <Plus size={32} strokeWidth={1.5} />
            </div>
            <span>{t('branches.addNewBranch')}</span>
          </Link>
        </div>
      ) : (
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">
            <Building2 size={48} strokeWidth={1} />
          </div>
          <h3>{t('branches.noBranches')}</h3>
          <p>{t('branches.createFirst')}</p>
          <Link to="/dashboard/branches/new" className="btn btn-primary">
            <Plus size={18} strokeWidth={2} />
            {t('branches.addFirstBranch')}
          </Link>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingBranch}
        onClose={() => setDeletingBranch(null)}
        onConfirm={handleConfirmDelete}
        title={t('branches.deleteBranch')}
        message={t('branches.deleteConfirmMessage', { name: deletingBranch?.name })}
        confirmText={t('branches.deleteBranch')}
        variant="danger"
      />
    </div>
  );
}
