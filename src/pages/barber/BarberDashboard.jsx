import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
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
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { format } from 'date-fns';
import './BarberDashboard.css';

function MetricCard({ icon: Icon, label, value, subValue, trend, color, delay }) {
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

function BookingStatusBadge({ status }) {
  const config = {
    confirmed: { icon: CheckCircle, label: 'Confirmed', class: 'status-confirmed' },
    pending: { icon: AlertCircle, label: 'Pending', class: 'status-pending' },
    'in-progress': { icon: Clock, label: 'In Progress', class: 'status-progress' },
    completed: { icon: CheckCircle, label: 'Completed', class: 'status-completed' },
    cancelled: { icon: XCircle, label: 'Cancelled', class: 'status-cancelled' },
    'no-show': { icon: XCircle, label: 'No Show', class: 'status-noshow' },
  };

  const { icon: Icon, label, class: className } = config[status] || config.pending;

  return (
    <span className={`booking-status ${className}`}>
      <Icon size={12} strokeWidth={2} />
      {label}
    </span>
  );
}

function TodayBookingItem({ booking, onComplete, onCancel }) {
  const canTakeAction = ['confirmed', 'pending', 'in-progress'].includes(booking.status);

  return (
    <div className="today-booking-item">
      <div className="today-booking-time">
        <span className="today-booking-hour">{booking.time}</span>
        <span className="today-booking-duration">{booking.duration} min</span>
      </div>
      <div className="today-booking-details">
        <div className="today-booking-customer">{booking.customerName}</div>
        <div className="today-booking-service">{booking.serviceName}</div>
      </div>
      <div className="today-booking-actions">
        <BookingStatusBadge status={booking.status} />
        {canTakeAction && (
          <div className="today-booking-btns">
            <button
              className="booking-action-btn complete"
              onClick={() => onComplete(booking.id)}
              title="Mark as completed"
            >
              <Check size={14} strokeWidth={2} />
            </button>
            <button
              className="booking-action-btn cancel"
              onClick={() => onCancel(booking.id)}
              title="Cancel booking"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BarberDashboard() {
  const {
    currentBarber,
    barberBookings,
    barberServices,
    barberMetrics,
    barberBranch,
    updateBooking,
    cancelBooking,
  } = useApp();

  if (!currentBarber || !barberMetrics) {
    return (
      <div className="dashboard">
        <div className="dashboard-empty-state">
          <Calendar size={40} strokeWidth={1} />
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().split('T')[0];

  const todayBookings = useMemo(() => {
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

  const upcomingBookings = todayBookings.filter(b =>
    ['confirmed', 'pending', 'in-progress'].includes(b.status)
  );

  const handleComplete = (bookingId) => {
    updateBooking(bookingId, { status: 'completed' });
  };

  const handleCancel = (bookingId) => {
    cancelBooking(bookingId);
  };

  return (
    <div className="dashboard">
      {/* Welcome Section */}
      <div className="dashboard-welcome animate-fade-in">
        <div className="dashboard-welcome-content">
          <h2 className="dashboard-welcome-title">
            Good {getTimeOfDay()}, {currentBarber.name.split(' ')[0]}
          </h2>
          <p className="dashboard-welcome-text">
            Here's your schedule at <span className="text-accent">{barberBranch?.name}</span> today.
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
          label="Today's Appointments"
          value={barberMetrics.todayTotal}
          subValue={`${barberMetrics.todayCompleted} completed, ${barberMetrics.todayUpcoming} upcoming`}
          color="accent"
          delay={1}
        />
        <MetricCard
          icon={Clock}
          label="This Week"
          value={barberMetrics.weekTotal}
          subValue="Total bookings"
          color="info"
          delay={2}
        />
        <MetricCard
          icon={DollarSign}
          label="My Earnings"
          value={`${barberMetrics.weekEarnings.toLocaleString()} KWD`}
          subValue="This week"
          trend={8}
          color="success"
          delay={3}
        />
        <MetricCard
          icon={Target}
          label="Completion Rate"
          value={`${barberMetrics.completionRate}%`}
          subValue="Completed vs no-show"
          color="secondary"
          delay={4}
        />
      </div>

      {/* Main Content Grid */}
      <div className="dashboard-grid">
        {/* Today's Schedule */}
        <div className="dashboard-card today-schedule animate-fade-in-up stagger-5">
          <div className="dashboard-card-header">
            <div className="dashboard-card-title">
              <Clock size={20} strokeWidth={1.5} />
              <h3>Today's Schedule</h3>
            </div>
            <Link to="/barber/bookings" className="dashboard-card-link">
              View All <ArrowRight size={14} strokeWidth={2} />
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
                  />
                ))}
              </div>
            ) : (
              <div className="dashboard-empty-state">
                <Calendar size={40} strokeWidth={1} />
                <p>No upcoming bookings for today</p>
                <Link to="/barber/bookings" className="btn btn-primary btn-sm">
                  <Plus size={16} strokeWidth={2} />
                  View Calendar
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
              <h3>Quick Actions</h3>
            </div>
          </div>

          <div className="dashboard-card-content">
            <div className="quick-actions-grid">
              <Link to="/barber/bookings" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Calendar size={24} strokeWidth={1.5} />
                </div>
                <span>My Bookings</span>
              </Link>
              <Link to="/barber/availability" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Clock size={24} strokeWidth={1.5} />
                </div>
                <span>Update Hours</span>
              </Link>
              <Link to="/barber/profile" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Target size={24} strokeWidth={1.5} />
                </div>
                <span>My Profile</span>
              </Link>
              <Link to="/barber/settings" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Plus size={24} strokeWidth={1.5} />
                </div>
                <span>Settings</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Completed Today */}
        <div className="dashboard-card completed-today animate-fade-in-up stagger-6">
          <div className="dashboard-card-header">
            <div className="dashboard-card-title">
              <CheckCircle size={20} strokeWidth={1.5} />
              <h3>Completed Today</h3>
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
                          {booking.serviceName} • {booking.price} KWD
                        </span>
                      </div>
                      <span className="completed-booking-time">{booking.time}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="dashboard-empty-state small">
                <CheckCircle size={32} strokeWidth={1} />
                <p>No completed bookings yet</p>
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
