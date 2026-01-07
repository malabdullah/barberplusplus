import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Search,
  User,
  Phone,
  Calendar,
  Clock,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
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

export default function AgentCustomers() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;

  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerBookings, setCustomerBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // Search customers
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || searchQuery.length < 3) return;
    setLoading(true);
    try {
      const results = await agentService.searchCustomers(searchQuery);
      setCustomers(results);
      setSelectedCustomer(null);
      setCustomerBookings([]);
    } catch (error) {
      console.error('Error searching customers:', error);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  // Handle search on enter
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Load customer bookings
  const loadCustomerBookings = async (customer) => {
    setSelectedCustomer(customer);
    setLoadingBookings(true);
    try {
      const bookings = await agentService.getCustomerBookings(customer.phone);
      setCustomerBookings(bookings);
    } catch (error) {
      console.error('Error loading customer bookings:', error);
      setCustomerBookings([]);
    } finally {
      setLoadingBookings(false);
    }
  };

  return (
    <div className="agent-customers">
      {/* Page Header */}
      <div className="agent-page-header">
        <div className="agent-page-header-content">
          <h1 className="agent-page-title">{t('agent.customers.title')}</h1>
          <p className="agent-page-description">{t('agent.customers.subtitle')}</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="agent-customer-search">
        <div className="agent-search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder={t('agent.customers.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="agent-search-input"
          />
          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={loading || searchQuery.length < 3}
          >
            {loading ? <RefreshCw size={16} className="spin" /> : t('common.search')}
          </button>
        </div>
        <p className="agent-search-hint">{t('agent.customers.searchHint')}</p>
      </div>

      <div className="agent-customers-layout">
        {/* Customers List */}
        <div className="agent-customers-list">
          {customers.length === 0 ? (
            <div className="agent-empty-state small">
              <User size={32} />
              <p>{t('agent.customers.noCustomersFound')}</p>
            </div>
          ) : (
            customers.map((customer, index) => (
              <div
                key={`${customer.phone}-${index}`}
                className={`agent-customer-card ${selectedCustomer?.phone === customer.phone ? 'selected' : ''}`}
                onClick={() => loadCustomerBookings(customer)}
              >
                <div className="agent-customer-avatar">
                  {customer.name?.charAt(0) || '?'}
                </div>
                <div className="agent-customer-info">
                  <span className="agent-customer-name">{customer.name}</span>
                  <span className="agent-customer-phone">
                    <Phone size={12} />
                    {customer.countryCode} {customer.phone}
                  </span>
                </div>
                <ArrowRight size={16} className="agent-customer-arrow" />
              </div>
            ))
          )}
        </div>

        {/* Customer Details & Bookings */}
        <div className="agent-customer-details">
          {selectedCustomer ? (
            <>
              <div className="agent-customer-header">
                <div className="agent-customer-avatar large">
                  {selectedCustomer.name?.charAt(0) || '?'}
                </div>
                <div className="agent-customer-header-info">
                  <h2>{selectedCustomer.name}</h2>
                  <p>
                    <Phone size={14} />
                    {selectedCustomer.countryCode} {selectedCustomer.phone}
                  </p>
                </div>
                <Link to="/agent/bookings" className="btn btn-primary">
                  {t('agent.customers.createBooking')}
                </Link>
              </div>

              <div className="agent-customer-bookings">
                <h3>{t('agent.customers.bookingHistory')}</h3>
                {loadingBookings ? (
                  <div className="agent-loading">
                    <RefreshCw size={20} className="spin" />
                  </div>
                ) : customerBookings.length === 0 ? (
                  <div className="agent-empty-state small">
                    <Calendar size={24} />
                    <p>{t('agent.customers.noBookings')}</p>
                  </div>
                ) : (
                  <div className="agent-bookings-timeline">
                    {customerBookings.map((booking) => (
                      <div key={booking.id} className="agent-booking-timeline-item">
                        <div className="agent-booking-timeline-date">
                          <span className="day">
                            {format(parseISO(booking.date), 'd', { locale: dateLocale })}
                          </span>
                          <span className="month">
                            {format(parseISO(booking.date), 'MMM', { locale: dateLocale })}
                          </span>
                        </div>
                        <div className="agent-booking-timeline-content">
                          <div className="agent-booking-timeline-header">
                            <span className="time">
                              <Clock size={12} />
                              {booking.time}
                            </span>
                            <StatusBadge status={booking.status} t={t} />
                          </div>
                          <p className="agent-booking-timeline-services">
                            {booking.services?.map((s) => s.name).join(', ') || '—'}
                          </p>
                          <p className="agent-booking-timeline-barber">
                            {booking.barber?.name || '—'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="agent-empty-state">
              <User size={48} />
              <h3>{t('agent.customers.selectCustomer')}</h3>
              <p>{t('agent.customers.selectCustomerDesc')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
