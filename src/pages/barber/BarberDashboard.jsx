import React, { useMemo, memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  DollarSign,
  TrendingUp,
  Clock,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  XCircle,
  Plus,
  Check,
  X,
  Target,
  Loader2,
  UserX,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { format } from 'date-fns';
import './BarberDashboard.css';

function MetricCard({ icon: Icon, label, value, subValue, trend, color, delay, t }) {
  return (
    <div className={`metric-card animate-fade-in-up stagger-${delay}`}>
      <div className="metric-card-header">
        <div className={`metric-card-icon ${color}`}>
          <Icon size={22} strokeWidth={1.5} />
        </div>
        {trend !== undefined && trend !== null && (
          <div className={`metric-card-trend ${trend >= 0 ? 'positive' : 'negative'}`}>
            <TrendingUp size={14} strokeWidth={2} />
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
      <div className="metric-card-value">{value}</div>
      <div className="metric-card-label">{label}</div>
      {subValue && <div className="metric-card-sub">{subValue}</div>}
    </div>
  );
}

function BookingStatusBadge({ status, t }) {
  const config = {
    confirmed: { icon: CheckCircle, labelKey: 'bookings.statusConfirmed', class: 'status-confirmed' },
    pending: { icon: AlertCircle, labelKey: 'bookings.statusPending', class: 'status-pending' },
    completed: { icon: CheckCircle, labelKey: 'bookings.statusCompleted', class: 'status-completed' },
    cancelled: { icon: XCircle, labelKey: 'bookings.statusCancelled', class: 'status-cancelled' },
    'no-show': { icon: XCircle, labelKey: 'bookings.statusNoShow', class: 'status-noshow' },
  };

  const { icon: Icon, labelKey, class: className } = config[status] || config.pending;

  return (
    <span className={`booking-status ${className}`}>
      <Icon size={12} strokeWidth={2} />
      {t(labelKey)}
    </span>
  );
}

const TodayBookingItem = memo(function TodayBookingItem({ booking, onComplete, onCancel, t }) {
  const canTakeAction = ['confirmed', 'pending'].includes(booking.status);

  return (
    <div className="today-booking-item">
      <div className="today-booking-time">
        <span className="today-booking-hour">{booking.time}</span>
        <span className="today-booking-duration">{booking.duration} {t('common.min')}</span>
      </div>
      <div className="today-booking-details">
        <div className="today-booking-customer">{booking.customerName}</div>
        <div className="today-booking-service">{booking.serviceName}</div>
      </div>
      <div className="today-booking-actions">
        <BookingStatusBadge status={booking.status} t={t} />
        {canTakeAction && (
          <div className="today-booking-btns">
            <button
              className="booking-action-btn complete"
              onClick={() => onComplete(booking.id)}
              title={t('bookings.markCompleted')}
            >
              <Check size={14} strokeWidth={2} />
            </button>
            <button
              className="booking-action-btn cancel"
              onClick={() => onCancel(booking.id)}
              title={t('bookings.cancelBooking')}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default function BarberDashboard() {
  const { t } = useTranslation();
  const {
    currentBarber,
    barberBookings,
    barberServices,
    barberMetrics,
    barberMetricsLoading,
    barberBranch,
    barberProfileLoading,
    barberProfileError,
    updateBooking,
    cancelBooking,
    logout,
  } = useApp();

  // Calculate today's date (needed for useMemo dependency)
  const today = new Date().toISOString().split('T')[0];

  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  // This follows React's Rules of Hooks - hooks must be called in the same order every render
  const todayBookings = useMemo(() => {
    // Guard for when data isn't loaded yet
    if (!barberBookings || !barberServices) return [];

    const servicesMap = new Map(barberServices.map(s => [s.id, s]));

    return barberBookings
      .filter(b => b.date === today)
      .map(booking => {
        const services = (booking.serviceIds || [])
          .map(id => servicesMap.get(id))
          .filter(Boolean);

        return {
          ...booking,
          serviceName: services.map(s => s.name).join(', ') || 'No service',
        };
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [barberBookings, barberServices, today]);

  const upcomingBookings = useMemo(() =>
    todayBookings.filter(b => ['confirmed', 'pending'].includes(b.status)),
    [todayBookings]
  );

  // Event handlers (not hooks, can be defined anywhere)
  const handleComplete = (bookingId) => {
    updateBooking(bookingId, { status: 'completed' });
  };

  const handleCancel = (bookingId) => {
    cancelBooking(bookingId);
  };

  // NOW we can have early returns - all hooks have been called above

  // Show loading state while profile is being fetched OR hasn't been checked yet
  if (barberProfileLoading || (!currentBarber && !barberProfileError)) {
    return (
      <div className="dashboard">
        <div className="dashboard-empty-state">
          <Loader2 size={40} strokeWidth={1.5} className="animate-spin" />
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  // Show error state only if profile check actually completed and failed
  if (barberProfileError) {
    return (
      <div className="dashboard">
        <div className="dashboard-error-state">
          <UserX size={48} strokeWidth={1.5} />
          <h3>{t('errors.barberProfileNotFound')}</h3>
          <p>{t('errors.barberProfileNotFoundDesc')}</p>
          <button className="btn btn-primary" onClick={logout}>
            {t('auth.signOut')}
          </button>
        </div>
      </div>
    );
  }

  // Show loading state while metrics are being fetched
  if (barberMetricsLoading || !barberMetrics) {
    return (
      <div className="dashboard">
        <div className="dashboard-empty-state">
          <Loader2 size={40} strokeWidth={1.5} className="animate-spin" />
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Welcome Section */}
      <div className="dashboard-welcome animate-fade-in">
        <div className="dashboard-welcome-content">
          <h2 className="dashboard-welcome-title">
            {t(`dashboard.good${getTimeOfDay()}`)}, {currentBarber.name.split(' ')[0]}
          </h2>
          <p className="dashboard-welcome-text">
            {t('dashboard.hereIsYourSchedule')} <span className="text-accent">{barberBranch?.name}</span>
          </p>
        </div>
        <div className="dashboard-welcome-date">
          <div className="dashboard-date-day">{format(new Date(), 'EEEE')}</div>
          <div className="dashboard-date-full">{format(new Date(), 'MMMM d, yyyy')}</div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="dashboard-metrics">
        <MetricCard
          icon={Calendar}
          label={t('dashboard.todayAppointments')}
          value={barberMetrics.todayTotal}
          subValue={`${barberMetrics.todayCompleted} ${t('dashboard.completed')}, ${barberMetrics.todayUpcoming} ${t('dashboard.upcoming')}`}
          color="accent"
          delay={1}
          t={t}
        />
        <MetricCard
          icon={Clock}
          label={t('dashboard.thisWeek')}
          value={barberMetrics.weekTotal}
          subValue={t('dashboard.totalBookings')}
          color="info"
          delay={2}
          t={t}
        />
        <MetricCard
          icon={DollarSign}
          label={t('dashboard.myEarnings')}
          value={`${barberMetrics.weekEarnings.toLocaleString()} ${t('common.currency')}`}
          subValue={t('dashboard.thisWeek')}
          trend={8}
          color="success"
          delay={3}
          t={t}
        />
        <MetricCard
          icon={Target}
          label={t('dashboard.completionRate')}
          value={`${barberMetrics.completionRate}%`}
          subValue={t('dashboard.completedVsNoShow')}
          color="secondary"
          delay={4}
          t={t}
        />
      </div>

      {/* Main Content Grid */}
      <div className="dashboard-grid">
        {/* Today's Schedule */}
        <div className="dashboard-card today-schedule animate-fade-in-up stagger-5">
          <div className="dashboard-card-header">
            <div className="dashboard-card-title">
              <Clock size={20} strokeWidth={1.5} />
              <h3>{t('dashboard.todaySchedule')}</h3>
            </div>
            <Link to="/barber/bookings" className="dashboard-card-link">
              {t('common.viewAll')} <ArrowRight size={14} strokeWidth={2} />
            </Link>
          </div>

          <div className="dashboard-card-content">
            {upcomingBookings.length > 0 ? (
              <div className="today-bookings-list">
                {upcomingBookings.slice(0, 6).map((booking) => (
                  <TodayBookingItem
                    key={booking.id}
                    booking={booking}
                    onComplete={handleComplete}
                    onCancel={handleCancel}
                    t={t}
                  />
                ))}
              </div>
            ) : (
              <div className="dashboard-empty-state">
                <Calendar size={40} strokeWidth={1} />
                <p>{t('dashboard.noUpcomingBookings')}</p>
                <Link to="/barber/bookings" className="btn btn-primary btn-sm">
                  <Plus size={16} strokeWidth={2} />
                  {t('dashboard.viewCalendar')}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="dashboard-card quick-actions animate-fade-in-up stagger-6">
          <div className="dashboard-card-header">
            <div className="dashboard-card-title">
              <TrendingUp size={20} strokeWidth={1.5} />
              <h3>{t('dashboard.quickActions')}</h3>
            </div>
          </div>

          <div className="dashboard-card-content">
            <div className="quick-actions-grid">
              <Link to="/barber/bookings" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Calendar size={24} strokeWidth={1.5} />
                </div>
                <span>{t('nav.myBookings')}</span>
              </Link>
              <Link to="/barber/availability" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Clock size={24} strokeWidth={1.5} />
                </div>
                <span>{t('dashboard.updateHours')}</span>
              </Link>
              <Link to="/barber/profile" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Target size={24} strokeWidth={1.5} />
                </div>
                <span>{t('nav.myProfile')}</span>
              </Link>
              <Link to="/barber/settings" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Plus size={24} strokeWidth={1.5} />
                </div>
                <span>{t('nav.settings')}</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Completed Today */}
        <div className="dashboard-card completed-today animate-fade-in-up stagger-6">
          <div className="dashboard-card-header">
            <div className="dashboard-card-title">
              <CheckCircle size={20} strokeWidth={1.5} />
              <h3>{t('dashboard.completedToday')}</h3>
            </div>
          </div>

          <div className="dashboard-card-content">
            {todayBookings.filter(b => b.status === 'completed').length > 0 ? (
              <div className="completed-bookings-list">
                {todayBookings
                  .filter(b => b.status === 'completed')
                  .slice(0, 4)
                  .map((booking) => (
                    <div key={booking.id} className="completed-booking-item">
                      <div className="completed-booking-check">
                        <CheckCircle size={16} strokeWidth={2} />
                      </div>
                      <div className="completed-booking-info">
                        <span className="completed-booking-customer">{booking.customerName}</span>
                        <span className="completed-booking-service">
                          {booking.serviceName} • {booking.price} {t('common.currency')}
                        </span>
                      </div>
                      <span className="completed-booking-time">{booking.time}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="dashboard-empty-state small">
                <CheckCircle size={32} strokeWidth={1} />
                <p>{t('dashboard.noCompletedBookings')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
