import React from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { Calendar, User, Tag, FileText } from 'lucide-react';

/**
 * CustomerSummaryCard - Displays customer context in booking form
 * Shows total visits, last visit, preferred barber, tags, and notes
 *
 * @param {Object} props
 * @param {Object} props.customer - Customer object from useCustomerLookup
 * @param {boolean} [props.loading] - Whether additional data is loading
 */
function CustomerSummaryCard({ customer, loading = false }) {
  const { t } = useTranslation();

  if (!customer) return null;

  const formatDate = (dateString) => {
    if (!dateString) return null;
    try {
      return format(parseISO(dateString), 'MMM d, yyyy');
    } catch {
      return dateString;
    }
  };

  const hasTags = customer.tags && customer.tags.length > 0;
  const hasNotes = customer.notes && customer.notes.trim();

  return (
    <div className="customer-summary-card">
      <div className="customer-summary-header">
        <span className="customer-summary-title">
          {t('bookings.customerSummary.returningCustomer', 'Returning Customer')}
        </span>
      </div>

      <div className="customer-summary-stats">
        {/* Total visits */}
        <div className="customer-summary-stat">
          <Calendar size={14} className="customer-summary-icon" />
          <span className="customer-summary-stat-value">{customer.totalBookings || 0}</span>
          <span className="customer-summary-stat-label">
            {t('bookings.customerSummary.totalVisits', 'Visits')}
          </span>
        </div>

        {/* Last visit */}
        {customer.lastBookingDate && (
          <div className="customer-summary-stat">
            <span className="customer-summary-stat-label">
              {t('bookings.customerSummary.lastVisit', 'Last visit')}:
            </span>
            <span className="customer-summary-stat-value">
              {formatDate(customer.lastBookingDate)}
            </span>
          </div>
        )}

        {/* Preferred barber */}
        {customer.preferredBarber && (
          <div className="customer-summary-stat">
            <User size={14} className="customer-summary-icon" />
            <span className="customer-summary-stat-label">
              {t('bookings.customerSummary.preferredBarber', 'Preferred')}:
            </span>
            <span className="customer-summary-stat-value">
              {customer.preferredBarber.name || customer.preferredBarber}
            </span>
          </div>
        )}
      </div>

      {/* Tags */}
      {hasTags && (
        <div className="customer-summary-tags">
          <Tag size={12} className="customer-summary-icon" />
          {customer.tags.map((tag, index) => (
            <span key={index} className="customer-summary-tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Notes (truncated) */}
      {hasNotes && (
        <div className="customer-summary-notes">
          <FileText size={12} className="customer-summary-icon" />
          <span className="customer-summary-notes-text">
            {customer.notes.length > 100
              ? `${customer.notes.substring(0, 100)}...`
              : customer.notes}
          </span>
        </div>
      )}

      {loading && (
        <div className="customer-summary-loading">
          <span className="spinner-small" />
        </div>
      )}
    </div>
  );
}

export default CustomerSummaryCard;
