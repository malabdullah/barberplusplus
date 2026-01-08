import React, { useState, useCallback, useEffect } from 'react';
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
  Plus,
  Edit2,
  Trash2,
  Mail,
  Tag,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { agentService } from '../../services/agent.service';
import { useApp } from '../../context/AppContext';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import CustomerForm from '../../components/Forms/CustomerForm';
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
  const { user, branches } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerBookings, setCustomerBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [totalCustomers, setTotalCustomers] = useState(0);

  // Modal states
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  // Load all barbers for preferred barber selector
  const [allBarbers, setAllBarbers] = useState([]);

  // Load initial customers on mount
  useEffect(() => {
    loadCustomers();
    loadAllBarbers();
  }, []);

  // Load customers list
  const loadCustomers = async (search = '') => {
    setLoading(true);
    try {
      const result = await agentService.getAllCustomers({ search, limit: 100 });
      setCustomers(result.customers);
      setTotalCustomers(result.total);
    } catch (error) {
      console.error('Error loading customers:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load all barbers from all branches
  const loadAllBarbers = async () => {
    try {
      const barbersList = [];
      for (const branch of branches) {
        const branchBarbers = await agentService.getBarbers(branch.id);
        barbersList.push(...branchBarbers.map(b => ({ ...b, branchId: branch.id })));
      }
      setAllBarbers(barbersList);
    } catch (error) {
      console.error('Error loading barbers:', error);
    }
  };

  // Search customers
  const handleSearch = useCallback(async () => {
    if (searchQuery.trim().length < 2 && searchQuery.trim().length > 0) return;
    loadCustomers(searchQuery.trim());
    setSelectedCustomer(null);
    setCustomerBookings([]);
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

  // Open modal for adding new customer
  const handleAddCustomer = () => {
    setEditingCustomer(null);
    setShowCustomerModal(true);
  };

  // Open modal for editing customer
  const handleEditCustomer = (customer, e) => {
    e?.stopPropagation();
    setEditingCustomer(customer);
    setShowCustomerModal(true);
  };

  // Open delete confirmation
  const handleDeleteCustomer = (customer, e) => {
    e?.stopPropagation();
    setCustomerToDelete(customer);
    setShowDeleteConfirm(true);
  };

  // Submit customer form
  const handleCustomerSubmit = async (formData) => {
    setFormLoading(true);
    try {
      if (editingCustomer) {
        // Update existing customer
        const updated = await agentService.updateCustomer(editingCustomer.id, formData);
        setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
        if (selectedCustomer?.id === updated.id) {
          setSelectedCustomer(updated);
        }
      } else {
        // Create new customer
        const created = await agentService.createCustomer(formData, user?.id);
        setCustomers(prev => [created, ...prev]);
        setTotalCustomers(prev => prev + 1);
      }
      setShowCustomerModal(false);
      setEditingCustomer(null);
    } catch (error) {
      if (error.message === 'PHONE_EXISTS') {
        alert(t('agent.customers.validation.phoneExists'));
      } else {
        console.error('Error saving customer:', error);
        alert(t('common.error'));
      }
    } finally {
      setFormLoading(false);
    }
  };

  // Confirm delete
  const handleConfirmDelete = async () => {
    if (!customerToDelete) return;
    try {
      await agentService.deleteCustomer(customerToDelete.id);
      setCustomers(prev => prev.filter(c => c.id !== customerToDelete.id));
      setTotalCustomers(prev => prev - 1);
      if (selectedCustomer?.id === customerToDelete.id) {
        setSelectedCustomer(null);
        setCustomerBookings([]);
      }
      setShowDeleteConfirm(false);
      setCustomerToDelete(null);
    } catch (error) {
      console.error('Error deleting customer:', error);
      alert(t('common.error'));
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
        <button className="btn btn-primary" onClick={handleAddCustomer}>
          <Plus size={18} />
          {t('agent.customers.addCustomer')}
        </button>
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
            disabled={loading}
          >
            {loading ? <RefreshCw size={16} className="spin" /> : t('common.search')}
          </button>
        </div>
        <p className="agent-search-hint">
          {totalCustomers > 0
            ? t('agent.customers.totalCount', { count: totalCustomers })
            : t('agent.customers.searchHint')}
        </p>
      </div>

      <div className="agent-customers-layout">
        {/* Customers List */}
        <div className="agent-customers-list">
          {loading ? (
            <div className="agent-loading">
              <RefreshCw size={24} className="spin" />
            </div>
          ) : customers.length === 0 ? (
            <div className="agent-empty-state small">
              <User size={32} />
              <p>{t('agent.customers.noCustomersFound')}</p>
            </div>
          ) : (
            customers.map((customer) => (
              <div
                key={customer.id}
                className={`agent-customer-card ${selectedCustomer?.id === customer.id ? 'selected' : ''}`}
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
                  {customer.tags?.length > 0 && (
                    <div className="agent-customer-tags">
                      {customer.tags.slice(0, 2).map((tag, idx) => (
                        <span key={idx} className="agent-customer-tag">{tag}</span>
                      ))}
                      {customer.tags.length > 2 && (
                        <span className="agent-customer-tag more">+{customer.tags.length - 2}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="agent-customer-actions">
                  <button
                    className="agent-customer-action-btn"
                    onClick={(e) => handleEditCustomer(customer, e)}
                    title={t('common.edit')}
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    className="agent-customer-action-btn delete"
                    onClick={(e) => handleDeleteCustomer(customer, e)}
                    title={t('common.delete')}
                  >
                    <Trash2 size={16} />
                  </button>
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
                  {selectedCustomer.nameAr && (
                    <p className="agent-customer-name-ar" dir="rtl">{selectedCustomer.nameAr}</p>
                  )}
                  <p>
                    <Phone size={14} />
                    {selectedCustomer.countryCode} {selectedCustomer.phone}
                  </p>
                  {selectedCustomer.email && (
                    <p>
                      <Mail size={14} />
                      {selectedCustomer.email}
                    </p>
                  )}
                </div>
                <div className="agent-customer-header-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={(e) => handleEditCustomer(selectedCustomer, e)}
                  >
                    <Edit2 size={16} />
                    {t('common.edit')}
                  </button>
                  <Link
                    to="/agent/bookings/new"
                    state={{
                      customerName: selectedCustomer.name,
                      customerCountryCode: selectedCustomer.countryCode,
                      customerPhone: selectedCustomer.phone,
                    }}
                    className="btn btn-primary"
                  >
                    {t('agent.customers.createBooking')}
                  </Link>
                </div>
              </div>

              {/* Customer Stats */}
              <div className="agent-customer-stats">
                <div className="agent-customer-stat">
                  <span className="stat-label">{t('agent.customers.stats.totalBookings')}</span>
                  <span className="stat-value">{selectedCustomer.totalBookings || 0}</span>
                </div>
                <div className="agent-customer-stat">
                  <span className="stat-label">{t('agent.customers.stats.lastVisit')}</span>
                  <span className="stat-value">
                    {selectedCustomer.lastBookingDate
                      ? format(parseISO(selectedCustomer.lastBookingDate), 'dd MMM yyyy', { locale: dateLocale })
                      : '—'}
                  </span>
                </div>
                <div className="agent-customer-stat">
                  <span className="stat-label">{t('agent.customers.stats.memberSince')}</span>
                  <span className="stat-value">
                    {format(parseISO(selectedCustomer.createdAt), 'dd MMM yyyy', { locale: dateLocale })}
                  </span>
                </div>
              </div>

              {/* Tags */}
              {selectedCustomer.tags?.length > 0 && (
                <div className="agent-customer-tags-section">
                  <h4>
                    <Tag size={16} />
                    {t('agent.customers.form.tags')}
                  </h4>
                  <div className="agent-customer-tags large">
                    {selectedCustomer.tags.map((tag, idx) => (
                      <span key={idx} className="agent-customer-tag">{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {selectedCustomer.notes && (
                <div className="agent-customer-notes-section">
                  <h4>{t('agent.customers.form.notes')}</h4>
                  <p>{selectedCustomer.notes}</p>
                </div>
              )}

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

      {/* Customer Form Modal */}
      <Modal
        isOpen={showCustomerModal}
        onClose={() => {
          setShowCustomerModal(false);
          setEditingCustomer(null);
        }}
        title={editingCustomer ? t('agent.customers.editCustomer') : t('agent.customers.addCustomer')}
        size="medium"
      >
        <CustomerForm
          customer={editingCustomer}
          branches={branches}
          barbers={allBarbers}
          onSubmit={handleCustomerSubmit}
          onCancel={() => {
            setShowCustomerModal(false);
            setEditingCustomer(null);
          }}
          loading={formLoading}
        />
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setCustomerToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title={t('agent.customers.deleteConfirmTitle')}
        message={t('agent.customers.deleteConfirmMessage', { name: customerToDelete?.name })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        type="danger"
      />
    </div>
  );
}
