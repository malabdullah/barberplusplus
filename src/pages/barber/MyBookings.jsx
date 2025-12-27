import React, { useState, useMemo, useEffect } from 'react';
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
} from 'lucide-react';
import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isToday,
} from 'date-fns';
import { useApp } from '../../context/AppContext';
import { TIME_SLOTS } from '../../constants/time';
import { GCC_COUNTRIES } from '../../constants/countries';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import './MyBookings.css';

function BookingForm({ booking, services, currentBarber, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    customerName: booking?.customerName || '',
    customerCountryCode: booking?.customerCountryCode || '+965',
    customerPhone: booking?.customerPhone || '',
    serviceIds: booking?.serviceIds || [],
    date: booking?.date || format(new Date(), 'yyyy-MM-dd'),
    time: booking?.time || '09:00',
    notes: booking?.notes || '',
  });

  const [errors, setErrors] = useState({});

  // Calculate totals from selected services
  const selectedServices = services.filter(s => formData.serviceIds.includes(s.id));
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  useEffect(() => {
    if (!booking?.customerCountryCode) {
      fetch('http://ip-api.com/json/?fields=countryCode')
        .then(res => res.json())
        .then(data => {
          const country = GCC_COUNTRIES.find(c => c.country === data.countryCode);
          if (country) {
            setFormData(prev => ({ ...prev, customerCountryCode: country.code }));
          }
        })
        .catch(() => {});
    }
  }, [booking?.customerCountryCode]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const toggleService = (serviceId) => {
    setFormData((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(serviceId)
        ? prev.serviceIds.filter(id => id !== serviceId)
        : [...prev.serviceIds, serviceId]
    }));
    if (errors.serviceIds) {
      setErrors((prev) => ({ ...prev, serviceIds: null }));
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.customerName.trim()) newErrors.customerName = 'Customer name is required';
    if (!formData.customerPhone.trim()) {
      newErrors.customerPhone = 'Phone is required';
    } else {
      const country = GCC_COUNTRIES.find(c => c.code === formData.customerCountryCode);
      if (country && !country.pattern.test(formData.customerPhone.replace(/\s/g, ''))) {
        newErrors.customerPhone = `Invalid ${country.label.split(' ')[0]} phone number`;
      }
    }
    if (!formData.serviceIds.length) newErrors.serviceIds = 'Please select at least one service';
    if (!formData.date) newErrors.date = 'Date is required';
    if (!formData.time) newErrors.time = 'Time is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onSubmit({
        ...formData,
        barberId: currentBarber.id,
      });
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-section">
        <h4 className="form-section-title">Customer Information</h4>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Customer Name</label>
            <input
              type="text"
              name="customerName"
              value={formData.customerName}
              onChange={handleChange}
              className={`form-input ${errors.customerName ? 'error' : ''}`}
              placeholder="Full name"
            />
            {errors.customerName && <span className="form-error">{errors.customerName}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div className="phone-input-group">
              <select
                name="customerCountryCode"
                value={formData.customerCountryCode}
                onChange={handleChange}
                className="form-input form-select country-code-select"
              >
                {GCC_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                name="customerPhone"
                value={formData.customerPhone}
                onChange={handleChange}
                className={`form-input phone-number-input ${errors.customerPhone ? 'error' : ''}`}
                placeholder="XXXX XXXX"
              />
            </div>
            {errors.customerPhone && <span className="form-error">{errors.customerPhone}</span>}
          </div>
        </div>
      </div>

      <div className="form-section">
        <h4 className="form-section-title">Booking Details</h4>

        <div className="form-group">
          <label className="form-label">Services</label>
          <div className={`services-select-grid ${errors.serviceIds ? 'error' : ''}`}>
            {services.map((service) => {
              const isSelected = formData.serviceIds.includes(service.id);
              return (
                <label
                  key={service.id}
                  className={`service-checkbox-card ${isSelected ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleService(service.id)}
                  />
                  <div className="service-checkbox-content">
                    <span className="service-checkbox-name">{service.name}</span>
                    <span className="service-checkbox-meta">
                      {service.duration} min - {service.price} KWD
                    </span>
                  </div>
                  <div className="service-checkbox-check">
                    <Check size={14} strokeWidth={2} />
                  </div>
                </label>
              );
            })}
          </div>
          {errors.serviceIds && <span className="form-error">{errors.serviceIds}</span>}
          {formData.serviceIds.length > 0 && (
            <div className="services-total">
              <span>Total:</span>
              <span className="services-total-value">{totalDuration} min - {totalPrice} KWD</span>
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              className={`form-input ${errors.date ? 'error' : ''}`}
            />
            {errors.date && <span className="form-error">{errors.date}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">Time</label>
            <select
              name="time"
              value={formData.time}
              onChange={handleChange}
              className={`form-input form-select ${errors.time ? 'error' : ''}`}
            >
              {TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
            {errors.time && <span className="form-error">{errors.time}</span>}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Notes (optional)</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            className="form-input form-textarea"
            placeholder="Any special requests or notes..."
            rows={2}
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          {booking ? 'Update Booking' : 'Create Booking'}
        </button>
      </div>
    </form>
  );
}

function BookingCard({ booking, onEdit }) {
  const statusConfig = {
    confirmed: { color: 'success', label: 'Confirmed' },
    pending: { color: 'warning', label: 'Pending' },
    'in-progress': { color: 'info', label: 'In Progress' },
    completed: { color: 'muted', label: 'Completed' },
    cancelled: { color: 'error', label: 'Cancelled' },
    'no-show': { color: 'error', label: 'No Show' },
  };

  const status = statusConfig[booking.status] || statusConfig.pending;

  return (
    <div className={`booking-card status-${status.color}`} onClick={() => onEdit(booking)}>
      <div className="booking-card-time">{booking.time}</div>
      <div className="booking-card-content">
        <div className="booking-card-customer">{booking.customerName}</div>
        <div className="booking-card-service">{booking.serviceName}</div>
      </div>
      <div className={`booking-card-status ${status.color}`}>{status.label}</div>
    </div>
  );
}

function BookingDetails({ booking, onClose, onCancel, onComplete }) {
  return (
    <div className="booking-details">
      <div className="booking-details-header">
        <div className={`booking-status-badge ${booking.status}`}>
          {booking.status.replace('-', ' ')}
        </div>
        <button className="booking-close-btn" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div className="booking-details-section">
        <div className="booking-detail-row">
          <User size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">Customer</span>
            <span className="detail-value">{booking.customerName}</span>
          </div>
        </div>
        <div className="booking-detail-row">
          <Phone size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">Phone</span>
            <span className="detail-value">{booking.customerCountryCode} {booking.customerPhone}</span>
          </div>
        </div>
      </div>

      <div className="booking-details-section">
        <div className="booking-detail-row">
          <Scissors size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">Service</span>
            <span className="detail-value">{booking.serviceName}</span>
          </div>
        </div>
        <div className="booking-detail-row">
          <Clock size={18} strokeWidth={1.5} />
          <div>
            <span className="detail-label">Time</span>
            <span className="detail-value">
              {booking.time} ({booking.duration} min)
            </span>
          </div>
        </div>
      </div>

      <div className="booking-details-price">
        <span>Total</span>
        <span className="price">{booking.price} KWD</span>
      </div>

      {booking.notes && (
        <div className="booking-details-notes">
          <AlertCircle size={14} />
          <span>{booking.notes}</span>
        </div>
      )}

      {['confirmed', 'pending', 'in-progress'].includes(booking.status) && (
        <div className="booking-details-actions">
          <button className="btn btn-ghost" onClick={() => onCancel(booking)}>
            <X size={16} />
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onComplete(booking)}>
            <Check size={16} />
            Complete
          </button>
        </div>
      )}
    </div>
  );
}

export default function MyBookings() {
  const {
    currentBarber,
    barberBookings,
    barberServices,
    barberBranch,
    addBooking,
    updateBooking,
    cancelBooking,
  } = useApp();

  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [cancellingBooking, setCancellingBooking] = useState(null);

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const bookingsByDate = useMemo(() => {
    const map = {};
    barberBookings.forEach((booking) => {
      if (!map[booking.date]) map[booking.date] = [];
      map[booking.date].push(booking);
    });
    Object.keys(map).forEach((date) => {
      map[date].sort((a, b) => a.time.localeCompare(b.time));
    });
    return map;
  }, [barberBookings]);

  const navigateWeek = (direction) => {
    setCurrentWeek((prev) =>
      direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1)
    );
  };

  const goToToday = () => {
    setCurrentWeek(new Date());
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

  if (!currentBarber) return null;

  return (
    <div className="bookings-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">My Bookings</h2>
          <p className="page-description">
            Your schedule at {barberBranch?.name}
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleAdd}>
          <Plus size={18} strokeWidth={2} />
          New Booking
        </button>
      </div>

      {/* Calendar Navigation */}
      <div className="calendar-nav animate-fade-in-up stagger-1">
        <div className="calendar-nav-left">
          <button className="btn btn-secondary" onClick={goToToday}>
            Today
          </button>
          <div className="calendar-nav-arrows">
            <button className="nav-arrow" onClick={() => navigateWeek('prev')}>
              <ChevronLeft size={20} strokeWidth={1.5} />
            </button>
            <button className="nav-arrow" onClick={() => navigateWeek('next')}>
              <ChevronRight size={20} strokeWidth={1.5} />
            </button>
          </div>
          <h3 className="calendar-period">
            {format(weekStart, 'MMMM d')} - {format(addDays(weekStart, 6), 'MMMM d, yyyy')}
          </h3>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="calendar-grid animate-fade-in-up stagger-2">
        {/* Header */}
        <div className="calendar-header">
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`calendar-header-cell ${isToday(day) ? 'today' : ''}`}
            >
              <span className="calendar-day-name">{format(day, 'EEE')}</span>
              <span className="calendar-day-number">{format(day, 'd')}</span>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="calendar-body">
          {weekDays.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayBookings = bookingsByDate[dateStr] || [];

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
                      />
                    ))}
                  </div>
                ) : (
                  <div className="calendar-day-empty">
                    <span>No bookings</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="calendar-legend animate-fade-in-up stagger-3">
        <div className="legend-item">
          <span className="legend-dot success"></span>
          <span>Confirmed</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot warning"></span>
          <span>Pending</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot info"></span>
          <span>In Progress</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot muted"></span>
          <span>Completed</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot error"></span>
          <span>Cancelled</span>
        </div>
      </div>

      {/* Booking Form Modal */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingBooking(null); }}
        title={editingBooking ? 'Edit Booking' : 'New Booking'}
        size="large"
      >
        <BookingForm
          booking={editingBooking}
          services={barberServices}
          currentBarber={currentBarber}
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
              onCancel={setCancellingBooking}
              onComplete={handleComplete}
            />
          </div>
        </div>
      )}

      {/* Cancel Confirmation */}
      <ConfirmDialog
        isOpen={!!cancellingBooking}
        onClose={() => setCancellingBooking(null)}
        onConfirm={handleCancelConfirm}
        title="Cancel Booking"
        message={`Are you sure you want to cancel the booking for ${cancellingBooking?.customerName}? The customer will be notified.`}
        confirmText="Cancel Booking"
        variant="danger"
      />
    </div>
  );
}
