import React, { useState, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  Scissors,
  Phone,
  X,
  Check,
  AlertCircle,
  UserCog,
  MessageCircle,
  Shield,
  Bot,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isSameDay,
  isToday,
  parseISO,
} from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { useApp } from '../context/AppContext';
import Modal from '../components/UI/Modal';
import ConfirmDialog from '../components/UI/ConfirmDialog';
import BookingForm from '../components/Forms/BookingForm';
import ModifyServicesSection from '../components/Bookings/ModifyServicesSection';
import { BOOKING_STATUSES, getStatusConfig } from '../constants/bookingStatuses';
import { getAddedByConfig } from '../constants/addedByTypes';
import './Bookings.css';

// Icon mapping for actor types
const ADDED_BY_ICONS = {
  manager: UserCog,
  barber: Scissors,
  whatsapp_agent: MessageCircle,
  admin: Shield,
  system: Bot,
};

const BookingCard = memo(function BookingCard({ booking, onEdit, onCancel, onComplete }) {
  const { t } = useTranslation();
  const statusConfig = {
    confirmed: { color: 'success', labelKey: 'bookings.status.confirmed' },
    pending: { color: 'warning', labelKey: 'bookings.status.pending' },
    completed: { color: 'muted', labelKey: 'bookings.status.completed' },
    cancelled: { color: 'error', labelKey: 'bookings.status.cancelled' },
    'no-show': { color: 'error', labelKey: 'bookings.status.noShow' },
  };

  const status = statusConfig[booking.status] || statusConfig.pending;

  return (
    <div className={`booking-card status-${status.color}`} onClick={() => onEdit(booking)}>
      <div className="booking-card-time">{booking.time}</div>
      <div className="booking-card-content">
        <div className="booking-card-customer">{booking.customerName}</div>
        <div className="booking-card-service">{booking.serviceName}</div>
        <div className="booking-card-barber">{booking.barberName}</div>
      </div>
      <div className={`booking-card-status ${status.color}`}>{t(status.labelKey)}</div>
    </div>
  );
});

// Calculate end time from start time and duration
const calculateEndTime = (startTime, durationMinutes) => {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
};

const BookingDetails = memo(function BookingDetails({
  booking,
  onClose,
  onStatusChange,
  services,
  barbers,
  existingBookings,
  onModifyServices,
}) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const barberData = barbers?.find(b => b.id === booking.barberId);

  return (
    <div className="booking-details">
      <div className="booking-details-header">
        <div className={`booking-status-badge ${booking.status}`}>
          {t(`bookings.status.${booking.status === 'no-show' ? 'noShow' : booking.status}`)}
        </div>
        <button className="booking-close-btn" onClick={onClose} aria-label={t('common.close')}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="booking-details-section">
        <div className="booking-detail-row">
          <User size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">{t('bookings.customer')}</span>
            <span className="detail-value">{booking.customerName}</span>
          </div>
        </div>
        <div className="booking-detail-row">
          <Phone size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">{t('common.phone')}</span>
            <span className="detail-value">{booking.customerCountryCode} {booking.customerPhone}</span>
          </div>
        </div>
      </div>

      <div className="booking-details-section">
        <div className="booking-detail-row">
          <Scissors size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">{t('bookings.service')}</span>
            <span className="detail-value">{booking.serviceName}</span>
          </div>
        </div>
        <div className="booking-detail-row">
          <User size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">{t('common.barber')}</span>
            <span className="detail-value">{booking.barberName}</span>
          </div>
        </div>
        <div className="booking-detail-row">
          <Calendar size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">{t('bookings.date')}</span>
            <span className="detail-value">
              {format(new Date(booking.date), 'EEEE, MMMM d, yyyy', { locale: dateLocale })}
            </span>
          </div>
        </div>
        <div className="booking-detail-row">
          <Clock size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">{t('bookings.time')}</span>
            <span className="detail-value">
              {booking.time?.substring(0, 5)} - {calculateEndTime(booking.time, booking.duration)} ({booking.duration} {t('common.min')})
            </span>
          </div>
        </div>
      </div>

      <div className="booking-details-price">
        <span>{t('bookings.total')}</span>
        <span className="price">{booking.price} {t('common.currency')}</span>
      </div>

      <ModifyServicesSection
        booking={booking}
        services={services}
        barberData={barberData}
        existingBookings={existingBookings}
        onSave={onModifyServices}
      />

      {booking.notes && (
        <div className="booking-details-notes">
          <AlertCircle size={14} />
          <span>{booking.notes}</span>
        </div>
      )}

      {/* Added By / Modified By Section */}
      {(booking.addedByType || booking.createdAt) && (
        <div className="booking-details-section booking-audit-section">
          {(booking.addedByType || booking.createdAt) && (
            <div className="booking-detail-row">
              {React.createElement(ADDED_BY_ICONS[booking.addedByType] || Bot, {
                size: 18,
                strokeWidth: 1.5,
              })}
              <div>
                <span className="detail-label">{t('bookings.addedBy.label')}</span>
                <span className="detail-value">
                  {booking.addedByType ? t(getAddedByConfig(booking.addedByType).labelKey) : '—'}
                  {booking.createdAt && (
                    <span className="detail-timestamp">
                      {t('bookings.addedBy.at')} {format(new Date(booking.createdAt), 'MMM d, yyyy h:mm a', { locale: dateLocale })}
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
          {(booking.modifiedByType || (booking.updatedAt && booking.updatedAt !== booking.createdAt)) && (
            <div className="booking-detail-row">
              {React.createElement(ADDED_BY_ICONS[booking.modifiedByType] || Bot, {
                size: 18,
                strokeWidth: 1.5,
              })}
              <div>
                <span className="detail-label">{t('bookings.modifiedBy.label')}</span>
                <span className="detail-value">
                  {booking.modifiedByType ? t(getAddedByConfig(booking.modifiedByType).labelKey) : '—'}
                  {booking.updatedAt && (
                    <span className="detail-timestamp">
                      {t('bookings.modifiedBy.at')} {format(new Date(booking.updatedAt), 'MMM d, yyyy h:mm a', { locale: dateLocale })}
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="booking-status-change">
        <span className="status-change-label">{t('bookings.changeStatus')}</span>
        <select
          className="status-change-select"
          value={booking.status}
          onChange={(e) => onStatusChange(booking.id, e.target.value)}
        >
          {BOOKING_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`bookings.status.${status === 'no-show' ? 'noShow' : status}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
});

export default function Bookings() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const {
    branchBookings,
    branchBarbers,
    branchServices,
    selectedBranch,
    addBooking,
    updateBooking,
    cancelBooking,
    changeBookingServices,
  } = useApp();

  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [viewMode, setViewMode] = useState('week'); // 'day' | 'week'
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [cancellingBooking, setCancellingBooking] = useState(null);

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const bookingsByDate = useMemo(() => {
    const map = {};
    branchBookings.forEach((booking) => {
      if (!map[booking.date]) map[booking.date] = [];
      map[booking.date].push(booking);
    });
    // Sort by time
    Object.keys(map).forEach((date) => {
      map[date].sort((a, b) => a.time.localeCompare(b.time));
    });
    return map;
  }, [branchBookings]);

  // Enrich bookings with barber and service names
  const enrichedBookingsByDate = useMemo(() => {
    const barbersMap = new Map(branchBarbers.map(b => [b.id, b]));
    const servicesMap = new Map(branchServices.map(s => [s.id, s]));
    const enriched = {};

    Object.entries(bookingsByDate).forEach(([date, bookings]) => {
      enriched[date] = bookings.map(booking => {
        const barber = barbersMap.get(booking.barberId);
        const services = (booking.serviceIds || [])
          .map(id => servicesMap.get(id))
          .filter(Boolean);

        return {
          ...booking,
          barberName: barber?.name || 'Unknown',
          serviceName: services.map(s => s.name).join(', ') || 'No service',
        };
      });
    });

    return enriched;
  }, [bookingsByDate, branchBarbers, branchServices]);

  const navigateWeek = (direction) => {
    setCurrentWeek((prev) =>
      direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1)
    );
  };

  const navigateDay = (direction) => {
    setSelectedDay((prev) =>
      direction === 'next' ? addDays(prev, 1) : addDays(prev, -1)
    );
  };

  const goToToday = () => {
    setCurrentWeek(new Date());
    setSelectedDay(new Date());
  };

  const handleAdd = () => {
    setEditingBooking(null);
    setIsFormOpen(true);
  };

  const handleEdit = (booking) => {
    setSelectedBooking(booking);
  };

  const handleFormSubmit = (data) => {
    if (editingBooking) {
      updateBooking(editingBooking.id, data);
    } else {
      addBooking(data);
    }
    setIsFormOpen(false);
    setEditingBooking(null);
  };

  const handleComplete = (booking) => {
    updateBooking(booking.id, { status: 'completed' });
    setSelectedBooking(null);
  };

  const handleCancelConfirm = () => {
    if (cancellingBooking) {
      cancelBooking(cancellingBooking.id);
      setCancellingBooking(null);
      setSelectedBooking(null);
    }
  };

  return (
    <div className="bookings-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">{t('nav.bookings')}</h2>
          <p className="page-description">
            {t('bookings.manageAppointments', { branch: selectedBranch?.name })}
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleAdd}>
          <Plus size={18} strokeWidth={2} />
          {t('bookings.newBooking')}
        </button>
      </div>

      {/* Calendar Navigation */}
      <div className="calendar-nav animate-fade-in-up stagger-1">
        <div className="calendar-nav-left">
          <button className="btn btn-secondary" onClick={goToToday}>
            {t('bookings.today')}
          </button>
          <div className="calendar-nav-arrows">
            <button
              className="nav-arrow"
              onClick={() => viewMode === 'week' ? navigateWeek('prev') : navigateDay('prev')}
              aria-label={t(viewMode === 'week' ? 'bookings.previousWeek' : 'bookings.previousDay')}
            >
              <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              className="nav-arrow"
              onClick={() => viewMode === 'week' ? navigateWeek('next') : navigateDay('next')}
              aria-label={t(viewMode === 'week' ? 'bookings.nextWeek' : 'bookings.nextDay')}
            >
              <ChevronRight size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <h3 className="calendar-period">
            {viewMode === 'week'
              ? `${format(weekStart, 'MMMM d', { locale: dateLocale })} - ${format(addDays(weekStart, 6), 'MMMM d, yyyy', { locale: dateLocale })}`
              : format(selectedDay, 'EEEE, MMMM d, yyyy', { locale: dateLocale })
            }
          </h3>
        </div>

        <div className="calendar-nav-right">
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
              onClick={() => setViewMode('week')}
            >
              {t('bookings.week')}
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'day' ? 'active' : ''}`}
              onClick={() => setViewMode('day')}
            >
              {t('bookings.day')}
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      {viewMode === 'week' ? (
        <div className="calendar-grid animate-fade-in-up stagger-2">
          {/* Header */}
          <div className="calendar-header">
            {weekDays.map((day) => (
              <div
                key={day.toISOString()}
                className={`calendar-header-cell ${isToday(day) ? 'today' : ''}`}
              >
                <span className="calendar-day-name">{format(day, 'EEE', { locale: dateLocale })}</span>
                <span className="calendar-day-number">{format(day, 'd')}</span>
              </div>
            ))}
          </div>

          {/* Body */}
          <div className="calendar-body">
            {weekDays.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const dayBookings = enrichedBookingsByDate[dateStr] || [];

              return (
                <div
                  key={day.toISOString()}
                  data-date={format(day, 'EEEE, MMM d')}
                  className={`calendar-day ${isToday(day) ? 'today' : ''}`}
                >
                  {dayBookings.length > 0 ? (
                    <div className="calendar-day-bookings">
                      {dayBookings.map((booking) => (
                        <BookingCard
                          key={booking.id}
                          booking={booking}
                          onEdit={handleEdit}
                          onCancel={setCancellingBooking}
                          onComplete={handleComplete}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="calendar-day-empty">
                      <span>{t('bookings.noBookings')}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="calendar-day-view animate-fade-in-up stagger-2">
          <div className="day-view-header">
            <span className="day-view-date">{format(selectedDay, 'EEEE', { locale: dateLocale })}</span>
            <span className="day-view-full-date">{format(selectedDay, 'MMMM d, yyyy', { locale: dateLocale })}</span>
          </div>
          <div className="day-view-bookings">
            {(() => {
              const dateStr = format(selectedDay, 'yyyy-MM-dd');
              const dayBookings = enrichedBookingsByDate[dateStr] || [];

              return dayBookings.length > 0 ? (
                dayBookings.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    onEdit={handleEdit}
                    onCancel={setCancellingBooking}
                    onComplete={handleComplete}
                  />
                ))
              ) : (
                <div className="calendar-day-empty">
                  <Calendar size={40} strokeWidth={1} />
                  <span>{t('bookings.noBookingsDay')}</span>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="calendar-legend animate-fade-in-up stagger-3">
        <div className="legend-item">
          <span className="legend-dot success"></span>
          <span>{t('bookings.status.confirmed')}</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot warning"></span>
          <span>{t('bookings.status.pending')}</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot muted"></span>
          <span>{t('bookings.status.completed')}</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot error"></span>
          <span>{t('bookings.status.cancelled')}</span>
        </div>
      </div>

      {/* Booking Form Modal */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingBooking(null); }}
        title={editingBooking ? t('bookings.editBooking') : t('bookings.newBooking')}
        size="large"
      >
        <BookingForm
          booking={editingBooking}
          barbers={branchBarbers}
          services={branchServices}
          existingBookings={branchBookings}
          onSubmit={handleFormSubmit}
          onCancel={() => { setIsFormOpen(false); setEditingBooking(null); }}
        />
      </Modal>

      {/* Booking Details Sidebar */}
      {selectedBooking && (
        <div className="booking-sidebar-overlay" onClick={() => setSelectedBooking(null)}>
          <div className="booking-sidebar animate-slide-in" onClick={(e) => e.stopPropagation()}>
            <BookingDetails
              booking={selectedBooking}
              onClose={() => setSelectedBooking(null)}
              onStatusChange={(id, status) => {
                updateBooking(id, { status });
                setSelectedBooking(null);
              }}
              services={branchServices}
              barbers={branchBarbers}
              existingBookings={branchBookings}
              onModifyServices={async (bookingId, newServiceIds) => {
                const updated = await changeBookingServices(bookingId, newServiceIds);
                // Update selectedBooking with new data
                if (updated) {
                  const barber = branchBarbers.find(b => b.id === updated.barberId);
                  const serviceNames = (updated.serviceIds || [])
                    .map(id => branchServices.find(s => s.id === id)?.name)
                    .filter(Boolean)
                    .join(', ');
                  setSelectedBooking({
                    ...updated,
                    barberName: barber?.name || 'Unknown',
                    serviceName: serviceNames || 'No service',
                  });
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Cancel Confirmation */}
      <ConfirmDialog
        isOpen={!!cancellingBooking}
        onClose={() => setCancellingBooking(null)}
        onConfirm={handleCancelConfirm}
        title={t('bookings.cancelBooking')}
        message={t('bookings.cancelConfirmMessage', { name: cancellingBooking?.customerName })}
        confirmText={t('bookings.cancelBooking')}
        variant="danger"
      />
    </div>
  );
}
