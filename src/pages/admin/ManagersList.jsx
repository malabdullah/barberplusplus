import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Search,
  Eye,
  Power,
  Building2,
  Mail,
  Phone,
  Calendar,
  ChevronLeft,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminService } from '../../services/admin.service';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import './AdminPages.css';

export default function ManagersList() {
  const { t } = useTranslation();

  // State
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedManager, setSelectedManager] = useState(null);
  const [managerDetails, setManagerDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);

  // Load managers
  useEffect(() => {
    loadManagers();
  }, []);

  const loadManagers = async () => {
    setLoading(true);
    try {
      const result = await adminService.getAllManagers({});
      setManagers(result.managers || []);
    } catch (error) {
      console.error('Error loading managers:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter managers
  const filteredManagers = useMemo(() => {
    let result = managers;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(m =>
        m.name?.toLowerCase().includes(query) ||
        m.email?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter === 'active') {
      result = result.filter(m => m.isActive);
    } else if (statusFilter === 'inactive') {
      result = result.filter(m => !m.isActive);
    }

    return result;
  }, [managers, searchQuery, statusFilter]);

  // View manager details
  const handleViewDetails = useCallback(async (manager) => {
    setSelectedManager(manager);
    setLoadingDetails(true);
    try {
      const details = await adminService.getManagerDetails(manager.id);
      setManagerDetails(details);
    } catch (error) {
      console.error('Error loading manager details:', error);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedManager(null);
    setManagerDetails(null);
  }, []);

  // Toggle manager status
  const handleToggleClick = useCallback((manager) => {
    setConfirmToggle(manager);
  }, []);

  const handleConfirmToggle = useCallback(async () => {
    if (!confirmToggle) return;

    setTogglingId(confirmToggle.id);
    try {
      const newStatus = !confirmToggle.isActive;
      await adminService.toggleManagerStatus(confirmToggle.id, newStatus);
      // Update local state
      setManagers(prev => prev.map(m =>
        m.id === confirmToggle.id ? { ...m, isActive: newStatus } : m
      ));
    } catch (error) {
      console.error('Error toggling manager status:', error);
    } finally {
      setTogglingId(null);
      setConfirmToggle(null);
    }
  }, [confirmToggle]);

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-page-header">
        <Link to="/admin/users" className="admin-back-link">
          <ChevronLeft size={18} />
          {t('admin.users.title')}
        </Link>
        <h1>{t('admin.users.managers')}</h1>
        <p>{t('admin.users.managersDesc')}</p>
      </div>

      {/* Toolbar */}
      <div className="admin-toolbar">
        <div className="admin-search-wrapper">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('admin.users.searchManagers')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="admin-filters">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">{t('common.all')}</option>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
          </select>
        </div>
        <div className="admin-count">
          {filteredManagers.length} {filteredManagers.length === 1 ? t('admin.users.manager') : t('admin.users.managers')}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="admin-loading">
          <Loader2 size={32} className="spinning" />
          <p>{t('common.loading')}</p>
        </div>
      ) : filteredManagers.length > 0 ? (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('common.email')}</th>
                <th>{t('common.phone')}</th>
                <th>{t('admin.users.branches')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.date')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredManagers.map((manager) => (
                <tr key={manager.id}>
                  <td>
                    <div className="admin-user-cell">
                      <div className="admin-user-avatar">
                        {manager.name?.charAt(0) || '?'}
                      </div>
                      <span>{manager.name || t('common.unknown')}</span>
                    </div>
                  </td>
                  <td>
                    <span className="admin-cell-secondary">{manager.email || '-'}</span>
                  </td>
                  <td>
                    <span className="admin-cell-secondary">{manager.phone || '-'}</span>
                  </td>
                  <td>
                    <span className="admin-badge">{manager.branchCount}</span>
                  </td>
                  <td>
                    <span className={`status-badge ${manager.isActive ? 'active' : 'inactive'}`}>
                      {manager.isActive ? t('common.active') : t('common.inactive')}
                    </span>
                  </td>
                  <td>
                    <span className="admin-cell-secondary">{formatDate(manager.createdAt)}</span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <button
                        className="admin-action-btn"
                        onClick={() => handleViewDetails(manager)}
                        title={t('common.view')}
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        className={`admin-action-btn ${manager.isActive ? 'danger' : 'success'}`}
                        onClick={() => handleToggleClick(manager)}
                        disabled={togglingId === manager.id}
                        title={manager.isActive ? t('admin.users.disable') : t('admin.users.enable')}
                      >
                        {togglingId === manager.id ? (
                          <Loader2 size={16} className="spinning" />
                        ) : (
                          <Power size={16} />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty">
          <div className="admin-empty-icon">
            <Users size={40} />
          </div>
          <h3>{searchQuery ? t('admin.users.noManagersFound') : t('admin.users.noManagers')}</h3>
          <p>{searchQuery ? t('admin.users.adjustSearch') : t('admin.users.noManagersDesc')}</p>
        </div>
      )}

      {/* Manager Details Modal */}
      <Modal
        isOpen={!!selectedManager}
        onClose={handleCloseModal}
        title={t('admin.users.managerDetails')}
      >
        {loadingDetails ? (
          <div className="admin-modal-loading">
            <Loader2 size={24} className="spinning" />
          </div>
        ) : managerDetails?.manager ? (
          <div className="admin-details">
            {/* Manager Info */}
            <div className="admin-details-section">
              <h4>{t('admin.users.contactInfo')}</h4>
              <div className="admin-detail-row">
                <Mail size={16} />
                <span>{managerDetails.manager.email || '-'}</span>
              </div>
              <div className="admin-detail-row">
                <Phone size={16} />
                <span>{managerDetails.manager.phone || '-'}</span>
              </div>
              <div className="admin-detail-row">
                <Calendar size={16} />
                <span>{t('admin.users.memberSince')}: {formatDate(managerDetails.manager.createdAt)}</span>
              </div>
            </div>

            {/* Branches */}
            <div className="admin-details-section">
              <h4>
                <Building2 size={16} />
                {t('admin.users.branches')} ({managerDetails.branches?.length || 0})
              </h4>
              {managerDetails.branches?.length > 0 ? (
                <div className="admin-branches-list">
                  {managerDetails.branches.map((branch) => (
                    <div key={branch.id} className="admin-branch-item">
                      <div className="admin-branch-info">
                        <span className="admin-branch-name">{branch.name}</span>
                        <span className="admin-branch-address">
                          {[branch.area, branch.governorate, branch.city].filter(Boolean).join(', ')}
                        </span>
                      </div>
                      <span className={`status-badge small ${branch.isActive ? 'active' : 'inactive'}`}>
                        {branch.isActive ? t('common.active') : t('common.inactive')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="admin-no-data">{t('admin.users.noBranches')}</p>
              )}
            </div>
          </div>
        ) : (
          <p className="admin-no-data">{t('admin.users.managerNotFound')}</p>
        )}
      </Modal>

      {/* Confirm Toggle Dialog */}
      <ConfirmDialog
        isOpen={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={handleConfirmToggle}
        title={confirmToggle?.isActive ? t('admin.users.disableManager') : t('admin.users.enableManager')}
        message={confirmToggle?.isActive ? t('admin.users.disableConfirm') : t('admin.users.enableConfirm')}
        confirmText={confirmToggle?.isActive ? t('admin.users.disable') : t('admin.users.enable')}
        variant={confirmToggle?.isActive ? 'danger' : 'primary'}
      />
    </div>
  );
}
