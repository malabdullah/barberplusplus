import React, { useState, useMemo } from 'react';
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
  Coffee,
  Umbrella,
  XCircle,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isToday,
  getDay,
  isWithinInterval,
  parseISO,
} from 'date-fns';
import { useApp } from '../../context/AppContext';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import BookingForm from '../../components/Forms/BookingForm';
import './MyBookings.css';

// Day index to key mapping (0=Sunday in JS Date.getDay())
const DAY_INDEX_TO_KEY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Unavailability block component for time-offs, vacations, and days-off
function UnavailabilityBlock({ block }) {
  const configs = {
    'day-off': {
      icon: XCircle,
      className: 'unavailable-block day-off',
      showTime: false,
    },
    'vacation': {
      icon: Umbrella,
      className: 'unavailable-block vacation',
      showTime: false,
    },
    'time-off-recurring': {
      icon: Coffee,
      className: 'unavailable-block time-off recurring',
      showTime: true,
    },
    'time-off-one-time': {
      icon: Clock,
      className: 'unavailable-block time-off one-time',
      showTime: true,
    },
  };

  const config = configs[block.type];
  const Icon = config.icon;

  return (
    <div className={config.className}>
      {config.showTime && (
        <span className="unavailable-block-time">
          {block.start} - {block.end}
        </span>
      )}
      <div className="unavailable-block-content">
        <Icon size={12} strokeWidth={2} />
        <span className="unavailable-block-label">
          {block.label || block.reason || block.type.replace(/-/g, ' ')}
        </span>
      </div>
    </div>
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

  // Enrich bookings with resolved service names
  const enrichedBookingsByDate = useMemo(() => {
    const servicesMap = new Map(barberServices.map(s => [s.id, s]));
    const enriched = {};

    Object.entries(bookingsByDate).forEach(([date, bookings]) => {
      enriched[date] = bookings.map(booking => {
        const services = (booking.serviceIds || [])
          .map(id => servicesMap.get(id))
          .filter(Boolean);

        return {
          ...booking,
          serviceName: services.map(s => s.name).join(', ') || 'No service',
          duration: booking.duration || services.reduce((sum, s) => sum + s.duration, 0),
          price: booking.price || services.reduce((sum, s) => sum + s.price, 0),
        };
      });
    });

    return enriched;
  }, [bookingsByDate, barberServices]);

  // Compute unavailability blocks for each day in the visible week
  const unavailabilityByDate = useMemo(() => {
    if (!currentBarber) return {};

    const { availability, timeOffs = [], vacations = [] } = currentBarber;
    const map = {};

    weekDays.forEach((day) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayKey = DAY_INDEX_TO_KEY[getDay(day)];
      const blocks = [];

      // 1. Check if it's a day off from weekly schedule
      if (availability && availability[dayKey] && !availability[dayKey].enabled) {
        blocks.push({
          type: 'day-off',
          fullDay: true,
          label: 'Day Off',
        });
      }

      // 2. Check if date falls within any vacation period
      vacations.forEach((vacation) => {
        const startDate = parseISO(vacation.startDate);
        const endDate = parseISO(vacation.endDate);
        if (isWithinInterval(day, { start: startDate, end: endDate })) {
          blocks.push({
            type: 'vacation',
            fullDay: true,
            label: 'Vacation',
            reason: vacation.reason,
            id: vacation.id,
          });
        }
      });

      // Only add partial blocks if no full-day block exists
      const hasFullDayBlock = blocks.some((b) => b.fullDay);

      if (!hasFullDayBlock) {
        // 3. Check for one-time time-offs on this date
        timeOffs
          .filter((t) => t.type === 'one-time' && t.date === dateStr)
          .forEach((timeOff) => {
            blocks.push({
              type: 'time-off-one-time',
              fullDay: false,
              start: timeOff.start,
              end: timeOff.end,
              reason: timeOff.reason,
              id: timeOff.id,
            });
          });

        // 4. Check for recurring time-offs on this day of week
        timeOffs
          .filter((t) => t.type === 'recurring' && t.day === dayKey)
          .forEach((timeOff) => {
            blocks.push({
              type: 'time-off-recurring',
              fullDay: false,
              start: timeOff.start,
              end: timeOff.end,
              reason: timeOff.reason,
              id: timeOff.id,
            });
          });
      }

      if (blocks.length > 0) {
        map[dateStr] = blocks;
      }
    });

    return map;
  }, [currentBarber, weekDays]);

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
          <input
            type="date"
            className="calendar-date-picker"
            value={format(currentWeek, 'yyyy-MM-dd')}
            onChange={(e) => e.target.value && setCurrentWeek(new Date(e.target.value))}
          />
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
            const dayBookings = enrichedBookingsByDate[dateStr] || [];
            const unavailableBlocks = unavailabilityByDate[dateStr] || [];

            // Separate full-day blocks from partial blocks
            const fullDayBlocks = unavailableBlocks.filter((b) => b.fullDay);
            const partialBlocks = unavailableBlocks.filter((b) => !b.fullDay);

            // Merge partial time-off blocks with bookings, sorted by time
            const allItems = [
              ...partialBlocks.map((b) => ({ ...b, isBlock: true, time: b.start })),
              ...dayBookings.map((b) => ({ ...b, isBlock: false })),
            ].sort((a, b) => a.time.localeCompare(b.time));

            const hasFullDayOff = fullDayBlocks.length > 0;

            return (
              <div
                key={day.toISOString()}
                data-date={format(day, 'EEEE, MMM d')}
                className={`calendar-day ${isToday(day) ? 'today' : ''} ${hasFullDayOff ? 'unavailable' : ''}`}
              >
                {/* Full-day blocks at top */}
                {fullDayBlocks.length > 0 && (
                  <div className="calendar-day-unavailable">
                    {fullDayBlocks.map((block, idx) => (
                      <UnavailabilityBlock key={block.id || idx} block={block} />
                    ))}
                  </div>
                )}

                {/* Bookings and partial time-offs */}
                {!hasFullDayOff && allItems.length > 0 ? (
                  <div className="calendar-day-bookings">
                    {allItems.map((item, idx) =>
                      item.isBlock ? (
                        <UnavailabilityBlock key={item.id || `block-${idx}`} block={item} />
                      ) : (
                        <BookingCard key={item.id} booking={item} onEdit={handleEdit} />
                      )
                    )}
                  </div>
                ) : !hasFullDayOff ? (
                  <div className="calendar-day-empty">
                    <span>No bookings</span>
                  </div>
                ) : null}
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
        <div className="legend-item">
          <span className="legend-dot vacation"></span>
          <span>Vacation</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot time-off"></span>
          <span>Time-Off</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot day-off"></span>
          <span>Day Off</span>
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
