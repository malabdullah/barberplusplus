import React, { useState, memo, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Plus,
  Phone,
  Mail,
  Pencil,
  Trash2,
  Search,
  Star,
  Calendar,
  RefreshCw,
  Send,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import ConfirmDialog from '../components/UI/ConfirmDialog';
import './Barbers.css';

const BarberCard = memo(function BarberCard({ barber, todayBookings, onDelete, onResendInvite, t }) {
  const navigate = useNavigate();
  const [isResending, setIsResending] = useState(false);
  const initials = barber.name?.split(' ').map((n) => n[0]).join('') || '??';

  const handleCardClick = () => {
    navigate(`/barbers/${barber.id}/edit`);
  };

  const handleEditClick = (e) => {
    e.stopPropagation();
    navigate(`/barbers/${barber.id}/edit`);
  };

  const handleScheduleClick = (e) => {
    e.stopPropagation();
    // View schedule - could navigate to schedule page
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    onDelete(barber);
  };

  const handleResendInvite = async (e) => {
    e.stopPropagation();
    setIsResending(true);
    try {
      await onResendInvite(barber.id);
    } finally {
      setIsResending(false);
    }
  };

  const getInviteStatusDisplay = () => {
    switch (barber.inviteStatus) {
      case 'accepted':
        return null; // Don't show badge for accepted invites
      case 'sent':
        return { label: t('barbers.invitePending'), className: 'pending' };
      case 'expired':
        return { label: t('barbers.inviteExpired'), className: 'expired' };
      default:
        return { label: t('barbers.notInvited'), className: 'not-invited' };
    }
  };

  const inviteStatus = getInviteStatusDisplay();
  const showResendButton = barber.inviteStatus && barber.inviteStatus !== 'accepted';

  const avatarUrl = barber.profilePicture || barber.avatarUrl;

  return (
    <div className="barber-card animate-fade-in-up" onClick={handleCardClick}>
      <div className="barber-card-header">
        <div className="barber-avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt={barber.name} />
          ) : (
            initials
          )}
        </div>
      </div>

      <div className="barber-card-content">
        <h3 className="barber-name">{barber.name}</h3>
        <div className="barber-status-row">
          <div className={`barber-status ${barber.status}`}>
            {barber.status === 'active' ? t('common.active') : t('barbers.away')}
          </div>
          {inviteStatus && (
            <div className={`invite-status ${inviteStatus.className}`}>
              <Send size={10} />
              {inviteStatus.label}
            </div>
          )}
        </div>

        {barber.bio && <p className="barber-bio">{barber.bio}</p>}

        {barber.specialties?.length > 0 && (
          <div className="barber-specialties">
            {barber.specialties.slice(0, 3).map((specialty) => (
              <span key={specialty} className="specialty-tag">
                <Star size={10} />
                {specialty}
              </span>
            ))}
            {barber.specialties.length > 3 && (
              <span className="specialty-more">+{barber.specialties.length - 3}</span>
            )}
          </div>
        )}

        <div className="barber-contact">
          <div className="contact-item">
            <Phone size={14} strokeWidth={1.5} />
            <span>{barber.phone}</span>
          </div>
          <div className="contact-item">
            <Mail size={14} strokeWidth={1.5} />
            <span>{barber.email}</span>
          </div>
        </div>

        <div className="barber-card-footer">
          <div className="barber-bookings">
            <Calendar size={14} strokeWidth={1.5} />
            <span>{todayBookings} {t('barbers.bookingsToday')}</span>
          </div>
          <div className="barber-actions">
            {showResendButton && (
              <button
                className="action-btn"
                onClick={handleResendInvite}
                title={t('barbers.resendInvite')}
                disabled={isResending}
              >
                <RefreshCw size={16} strokeWidth={1.5} className={isResending ? 'spinning' : ''} />
              </button>
            )}
            <button
              className="action-btn"
              onClick={handleEditClick}
              title={t('barbers.editProfile')}
            >
              <Pencil size={16} strokeWidth={1.5} />
            </button>
            <button
              className="action-btn"
              onClick={handleScheduleClick}
              title={t('barbers.viewSchedule')}
            >
              <Calendar size={16} strokeWidth={1.5} />
            </button>
            <button
              className="action-btn danger"
              onClick={handleDeleteClick}
              title={t('barbers.remove')}
            >
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default function Barbers() {
  const { t } = useTranslation();
  const {
    branchBarbers,
    branchBookings,
    selectedBranch,
    deleteBarber,
    resendBarberInvite,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [deletingBarber, setDeletingBarber] = useState(null);

  const today = new Date().toISOString().split('T')[0];

  // Memoize filtered barbers to prevent recalculation
  const filteredBarbers = useMemo(() =>
    branchBarbers.filter((barber) =>
      barber.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      barber.specialties?.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()))
    ),
    [branchBarbers, searchQuery]
  );

  // Pre-compute today's bookings per barber to avoid O(n*m) in render loop
  const barberTodayBookingsMap = useMemo(() => {
    const map = {};
    branchBookings
      .filter(b => b.date === today)
      .forEach(b => {
        map[b.barberId] = (map[b.barberId] || 0) + 1;
      });
    return map;
  }, [branchBookings, today]);

  const handleDelete = useCallback((barber) => {
    setDeletingBarber(barber);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deletingBarber) {
      deleteBarber(deletingBarber.id);
      setDeletingBarber(null);
    }
  }, [deletingBarber, deleteBarber]);

  const handleResendInvite = useCallback(async (barberId) => {
    try {
      await resendBarberInvite(barberId);
    } catch (error) {
      console.error('Error resending invite:', error);
    }
  }, [resendBarberInvite]);

  return (
    <div className="barbers-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">{t('barbers.title')}</h2>
          <p className="page-description">
            {t('barbers.subtitle')} {selectedBranch?.name}
          </p>
        </div>
        <Link to="/barbers/new" className="btn btn-primary">
          <Plus size={18} strokeWidth={2} />
          {t('barbers.addBarber')}
        </Link>
      </div>

      {/* Search Bar */}
      <div className="barbers-toolbar animate-fade-in-up stagger-1">
        <div className="search-input-wrapper">
          <Search size={18} strokeWidth={1.5} />
          <input
            type="text"
            placeholder={t('barbers.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="barbers-count">
          {filteredBarbers.length} {filteredBarbers.length === 1 ? t('common.barber') : t('barbers.barbersPlural')}
        </div>
      </div>

      {/* Barbers Grid */}
      {filteredBarbers.length > 0 ? (
        <div className="barbers-grid">
          {filteredBarbers.map((barber, index) => (
            <BarberCard
              key={barber.id}
              barber={barber}
              todayBookings={barberTodayBookingsMap[barber.id] || 0}
              onDelete={handleDelete}
              onResendInvite={handleResendInvite}
              t={t}
            />
          ))}
        </div>
      ) : searchQuery ? (
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">
            <Search size={48} strokeWidth={1} />
          </div>
          <h3>{t('barbers.noBarbersFound')}</h3>
          <p>{t('barbers.adjustSearch')}</p>
        </div>
      ) : (
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">
            <Users size={48} strokeWidth={1} />
          </div>
          <h3>{t('barbers.noBarbers')}</h3>
          <p>{t('barbers.addFirst')}</p>
          <Link to="/barbers/new" className="btn btn-primary">
            <Plus size={18} strokeWidth={2} />
            {t('barbers.addFirstBarber')}
          </Link>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingBarber}
        onClose={() => setDeletingBarber(null)}
        onConfirm={handleConfirmDelete}
        title={t('barbers.removeBarber')}
        message={t('barbers.deleteConfirm', { name: deletingBarber?.name })}
        confirmText={t('barbers.removeBarber')}
        variant="danger"
      />
    </div>
  );
}
