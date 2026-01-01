import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UserCheck,
  Search,
  Eye,
  Mail,
  Phone,
  Calendar,
  Building2,
  User,
  ChevronLeft,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminService } from '../../services/admin.service';
import Modal from '../../components/UI/Modal';
import './AdminPages.css';

export default function BarbersList() {
  const { t } = useTranslation();

  // State
  const [barbers, setBarbers] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');
  const [selectedBarber, setSelectedBarber] = useState(null);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [barbersResult, managersResult] = await Promise.all([
        adminService.getAllBarbers({ limit: 1000 }),
        adminService.getAllManagers({}),
      ]);
      setBarbers(barbersResult.barbers || []);
      setManagers(managersResult.managers || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter barbers
  const filteredBarbers = useMemo(() => {
    let result = barbers;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(b =>
        b.name?.toLowerCase().includes(query) ||
        b.email?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter === 'active') {
      result = result.filter(b => b.status === 'active');
    } else if (statusFilter === 'inactive') {
      result = result.filter(b => b.status !== 'active');
    }

    // Manager filter
    if (managerFilter !== 'all') {
      result = result.filter(b => b.managerId === managerFilter);
    }

    return result;
  }, [barbers, searchQuery, statusFilter, managerFilter]);

  // View barber details
  const handleViewDetails = useCallback((barber) => {
    setSelectedBarber(barber);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedBarber(null);
  }, []);

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Get invite status display
  const getInviteStatus = (status) => {
    switch (status) {
      case 'accepted':
        return { label: t('barbers.inviteAccepted'), className: 'success' };
      case 'sent':
        return { label: t('barbers.invitePending'), className: 'warning' };
      case 'expired':
        return { label: t('barbers.inviteExpired'), className: 'error' };
      default:
        return { label: t('barbers.notInvited'), className: 'neutral' };
    }
  };

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-page-header">
        <Link to="/admin/users" className="admin-back-link">
          <ChevronLeft size={18} />
          {t('admin.users.title')}
        </Link>
        <h1>{t('admin.users.barbers')}</h1>
        <p>{t('admin.users.barbersDesc')}</p>
      </div>

      {/* Toolbar */}
      <div className="admin-toolbar">
        <div className="admin-search-wrapper">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('admin.users.searchBarbers')}
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
          <select
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
          >
            <option value="all">{t('admin.users.allManagers')}</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-count">
          {filteredBarbers.length} {filteredBarbers.length === 1 ? t('common.barber') : t('admin.users.barbers')}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="admin-loading">
          <Loader2 size={32} className="spinning" />
          <p>{t('common.loading')}</p>
        </div>
      ) : filteredBarbers.length > 0 ? (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('common.email')}</th>
                <th>{t('common.phone')}</th>
                <th>{t('admin.users.branch')}</th>
                <th>{t('admin.users.manager')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.date')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredBarbers.map((barber) => (
                <tr key={barber.id}>
                  <td>
                    <div className="admin-user-cell">
                      {barber.avatarUrl ? (
                        <img
                          src={barber.avatarUrl}
                          alt={barber.name}
                          className="admin-user-avatar-img"
                        />
                      ) : (
                        <div className="admin-user-avatar">
                          {barber.name?.charAt(0) || '?'}
                        </div>
                      )}
                      <span>{barber.name || t('common.unknown')}</span>
                    </div>
                  </td>
                  <td>
                    <span className="admin-cell-secondary">{barber.email || '-'}</span>
                  </td>
                  <td>
                    <span className="admin-cell-secondary">{barber.phone || '-'}</span>
                  </td>
                  <td>
                    <span className="admin-cell-secondary">{barber.branchName || '-'}</span>
                  </td>
                  <td>
                    <span className="admin-cell-secondary">{barber.managerName || '-'}</span>
                  </td>
                  <td>
                    <span className={`status-badge ${barber.status === 'active' ? 'active' : 'inactive'}`}>
                      {barber.status === 'active' ? t('common.active') : t('common.inactive')}
                    </span>
                  </td>
                  <td>
                    <span className="admin-cell-secondary">{formatDate(barber.createdAt)}</span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <button
                        className="admin-action-btn"
                        onClick={() => handleViewDetails(barber)}
                        title={t('common.view')}
                      >
                        <Eye size={16} />
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
            <UserCheck size={40} />
          </div>
          <h3>{searchQuery ? t('admin.users.noBarbersFound') : t('admin.users.noBarbers')}</h3>
          <p>{searchQuery ? t('admin.users.adjustSearch') : t('admin.users.noBarbersDesc')}</p>
        </div>
      )}

      {/* Barber Details Modal */}
      <Modal
        isOpen={!!selectedBarber}
        onClose={handleCloseModal}
        title={t('admin.users.barberDetails')}
      >
        {selectedBarber && (
          <div className="admin-details">
            {/* Barber Avatar & Name */}
            <div className="admin-details-header">
              {selectedBarber.avatarUrl ? (
                <img
                  src={selectedBarber.avatarUrl}
                  alt={selectedBarber.name}
                  className="admin-details-avatar"
                />
              ) : (
                <div className="admin-details-avatar-placeholder">
                  {selectedBarber.name?.charAt(0) || '?'}
                </div>
              )}
              <div>
                <h3>{selectedBarber.name}</h3>
                <span className={`status-badge ${selectedBarber.status === 'active' ? 'active' : 'inactive'}`}>
                  {selectedBarber.status === 'active' ? t('common.active') : t('common.inactive')}
                </span>
              </div>
            </div>

            {/* Contact Info */}
            <div className="admin-details-section">
              <h4>{t('admin.users.contactInfo')}</h4>
              <div className="admin-detail-row">
                <Mail size={16} />
                <span>{selectedBarber.email || '-'}</span>
              </div>
              <div className="admin-detail-row">
                <Phone size={16} />
                <span>{selectedBarber.phone || '-'}</span>
              </div>
              <div className="admin-detail-row">
                <Calendar size={16} />
                <span>{t('admin.users.memberSince')}: {formatDate(selectedBarber.createdAt)}</span>
              </div>
            </div>

            {/* Assignment Info */}
            <div className="admin-details-section">
              <h4>{t('admin.users.assignmentInfo')}</h4>
              <div className="admin-detail-row">
                <Building2 size={16} />
                <span>{t('admin.users.branch')}: {selectedBarber.branchName || '-'}</span>
              </div>
              <div className="admin-detail-row">
                <User size={16} />
                <span>{t('admin.users.managedBy')}: {selectedBarber.managerName || '-'}</span>
              </div>
            </div>

            {/* Invite Status */}
            {selectedBarber.inviteStatus && (
              <div className="admin-details-section">
                <h4>{t('admin.users.inviteStatus')}</h4>
                <div className="admin-invite-status">
                  {(() => {
                    const status = getInviteStatus(selectedBarber.inviteStatus);
                    return (
                      <span className={`invite-badge ${status.className}`}>
                        {status.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
