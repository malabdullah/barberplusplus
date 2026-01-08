import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Search,
  Filter,
  Calendar,
  Clock,
  User,
  Phone,
  X,
  RefreshCw,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { useApp } from '../../context/AppContext';
import { agentService } from '../../services/agent.service';
import './AgentPages.css';

// Status badge component
const StatusBadge = ({ status, t }) => {
  const statusColors = {
    pending: 'warning',
    confirmed: 'info',
    completed: 'success',
    cancelled: 'error',
    no_show: 'error',
  };
  const color = statusColors[status] || 'secondary';
  return (
    <span className={`agent-status-badge ${color}`}>
      {t(`bookings.status.${status}`, { defaultValue: status })}
    </span>
  );
};

export default function AgentBookings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { selectedBranchId } = useApp();

  const [bookings, setBookings] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Load bookings and branch data
  useEffect(() => {
    const loadData = async () => {
      if (!selectedBranchId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [bookingsData, barbersData] = await Promise.all([
          agentService.getBookings({ branchId: selectedBranchId }),
          agentService.getBarbers(selectedBranchId),
        ]);
        setBookings(bookingsData.bookings || bookingsData);
        setBarbers(barbersData);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedBranchId]);

  // Filter bookings
  const filteredBookings = useMemo(() => {
    return bookings.filter((booking) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = booking.customerName?.toLowerCase().includes(query);
        const matchesPhone = booking.customerPhone?.includes(query);
        if (!matchesName && !matchesPhone) return false;
      }
      // Status filter
      if (statusFilter && booking.status !== statusFilter) return false;
      // Date filter
      if (dateFilter && booking.date !== dateFilter) return false;
      return true;
    });
  }, [bookings, searchQuery, statusFilter, dateFilter]);

  // Clear filters
  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setDateFilter('');
  };

  // Refresh bookings
  const handleRefresh = async () => {
    if (!selectedBranchId) return;
    setLoading(true);
    try {
      const data = await agentService.getBookings({ branchId: selectedBranchId });
      setBookings(data.bookings || data);
    } catch (error) {
      console.error('Error refreshing:', error);
    } finally {
      setLoading(false);
    }
  };

  // Navigate to new booking page
  const handleNewBooking = () => {
    navigate('/agent/bookings/new');
  };

  // Navigate to edit booking page
  const handleEditBooking = (bookingId) => {
    navigate(`/agent/bookings/${bookingId}/edit`);
  };

  return (
    <div className="agent-bookings">
      {/* Page Header */}
      <div className="agent-page-header">
        <div className="agent-page-header-content">
          <h1 className="agent-page-title">{t('agent.bookings.title')}</h1>
          <p className="agent-page-description">{t('agent.bookings.subtitle')}</p>
        </div>
        <div className="agent-page-actions">
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={loading || !selectedBranchId}
          >
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
            {t('common.refresh')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleNewBooking}
            disabled={!selectedBranchId}
          >
            <Plus size={18} />
            {t('bookings.newBooking')}
          </button>
        </div>
      </div>

      {/* Branch Selection Warning */}
      {!selectedBranchId && (
        <div className="agent-select-branch-notice">
          <Calendar size={48} />
          <h3>{t('agent.bookings.selectBranch')}</h3>
          <p>{t('agent.bookings.selectBranchDesc')}</p>
        </div>
      )}

      {selectedBranchId && (
        <>
          {/* Search and Filters */}
          <div className="agent-toolbar">
            <div className="agent-search">
              <Search size={18} />
              <input
                type="text"
                placeholder={t('bookings.searchBookings')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="agent-search-input"
              />
            </div>
            <button
              className={`btn btn-secondary ${showFilters ? 'active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter size={18} />
              {t('common.filters')}
            </button>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="agent-filters">
              <div className="agent-filter-group">
                <label>{t('bookings.status')}</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="form-input form-select"
                >
                  <option value="">{t('common.all')}</option>
                  <option value="pending">{t('bookings.status.pending')}</option>
                  <option value="confirmed">{t('bookings.status.confirmed')}</option>
                  <option value="completed">{t('bookings.status.completed')}</option>
                  <option value="cancelled">{t('bookings.status.cancelled')}</option>
                </select>
              </div>
              <div className="agent-filter-group">
                <label>{t('bookings.date')}</label>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="form-input"
                />
              </div>
              <button className="btn btn-text" onClick={clearFilters}>
                <X size={16} />
                {t('common.clear')}
              </button>
            </div>
          )}

          {/* Bookings List */}
          <div className="agent-bookings-list">
            {loading ? (
              <div className="agent-loading">
                <RefreshCw size={24} className="spin" />
                <span>{t('common.loading')}</span>
              </div>
            ) : filteredBookings.length === 0 ? (
              <div className="agent-empty-state">
                <Calendar size={48} />
                <h3>{t('bookings.noBookings')}</h3>
              </div>
            ) : (
              filteredBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="agent-booking-card"
                  onClick={() => handleEditBooking(booking.id)}
                >
                  <div className="agent-booking-header">
                    <div className="agent-booking-customer">
                      <User size={16} />
                      <span>{booking.customerName}</span>
                    </div>
                    <StatusBadge status={booking.status} t={t} />
                  </div>
                  <div className="agent-booking-details">
                    <div className="agent-booking-detail">
                      <Phone size={14} />
                      <span>{booking.customerPhone}</span>
                    </div>
                    <div className="agent-booking-detail">
                      <Calendar size={14} />
                      <span>
                        {format(parseISO(booking.date), 'MMM d, yyyy', { locale: dateLocale })}
                      </span>
                    </div>
                    <div className="agent-booking-detail">
                      <Clock size={14} />
                      <span>{booking.time}</span>
                    </div>
                  </div>
                  <div className="agent-booking-barber">
                    {barbers.find((b) => b.id === booking.barberId)?.name || '—'}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
