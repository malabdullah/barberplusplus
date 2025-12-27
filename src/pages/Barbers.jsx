import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

function BarberCard({ barber, todayBookings, onDelete, onResendInvite }) {
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
        return { label: 'Invite Pending', className: 'pending' };
      case 'expired':
        return { label: 'Invite Expired', className: 'expired' };
      default:
        return { label: 'Not Invited', className: 'not-invited' };
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
            {barber.status === 'active' ? 'Active' : 'Away'}
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
            <span>{todayBookings} bookings today</span>
          </div>
          <div className="barber-actions">
            {showResendButton && (
              <button
                className="action-btn"
                onClick={handleResendInvite}
                title="Resend Invite"
                disabled={isResending}
              >
                <RefreshCw size={16} strokeWidth={1.5} className={isResending ? 'spinning' : ''} />
              </button>
            )}
            <button
              className="action-btn"
              onClick={handleEditClick}
              title="Edit Profile"
            >
              <Pencil size={16} strokeWidth={1.5} />
            </button>
            <button
              className="action-btn"
              onClick={handleScheduleClick}
              title="View Schedule"
            >
              <Calendar size={16} strokeWidth={1.5} />
            </button>
            <button
              className="action-btn danger"
              onClick={handleDeleteClick}
              title="Remove"
            >
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Barbers() {
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

  const filteredBarbers = branchBarbers.filter((barber) =>
    barber.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    barber.specialties?.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getBarberTodayBookings = (barberId) => {
    return branchBookings.filter(
      (b) => b.barberId === barberId && b.date === today
    ).length;
  };

  const handleDelete = (barber) => {
    setDeletingBarber(barber);
  };

  const handleConfirmDelete = () => {
    if (deletingBarber) {
      deleteBarber(deletingBarber.id);
      setDeletingBarber(null);
    }
  };

  const handleResendInvite = async (barberId) => {
    try {
      await resendBarberInvite(barberId);
    } catch (error) {
      console.error('Error resending invite:', error);
    }
  };

  return (
    <div className="barbers-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">Barbers</h2>
          <p className="page-description">
            Manage your team at {selectedBranch?.name}
          </p>
        </div>
        <Link to="/barbers/new" className="btn btn-primary">
          <Plus size={18} strokeWidth={2} />
          Add Barber
        </Link>
      </div>

      {/* Search Bar */}
      <div className="barbers-toolbar animate-fade-in-up stagger-1">
        <div className="search-input-wrapper">
          <Search size={18} strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search by name or specialty..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="barbers-count">
          {filteredBarbers.length} barber{filteredBarbers.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Barbers Grid */}
      {filteredBarbers.length > 0 ? (
        <div className="barbers-grid">
          {filteredBarbers.map((barber, index) => (
            <BarberCard
              key={barber.id}
              barber={barber}
              todayBookings={getBarberTodayBookings(barber.id)}
              onDelete={handleDelete}
              onResendInvite={handleResendInvite}
              style={{ animationDelay: `${index * 50}ms` }}
            />
          ))}
        </div>
      ) : searchQuery ? (
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">
            <Search size={48} strokeWidth={1} />
          </div>
          <h3>No barbers found</h3>
          <p>Try adjusting your search query</p>
        </div>
      ) : (
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">
            <Users size={48} strokeWidth={1} />
          </div>
          <h3>No barbers yet</h3>
          <p>Add your first team member to get started</p>
          <Link to="/barbers/new" className="btn btn-primary">
            <Plus size={18} strokeWidth={2} />
            Add Your First Barber
          </Link>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingBarber}
        onClose={() => setDeletingBarber(null)}
        onConfirm={handleConfirmDelete}
        title="Remove Barber"
        message={`Are you sure you want to remove "${deletingBarber?.name}" from your team? Their booking history will be preserved.`}
        confirmText="Remove Barber"
        variant="danger"
      />
    </div>
  );
}
