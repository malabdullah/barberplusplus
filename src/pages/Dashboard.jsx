import React, { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  DollarSign,
  Users,
  Scissors,
  TrendingUp,
  Clock,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  XCircle,
  Plus,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { format, isToday, parseISO } from 'date-fns';
import './Dashboard.css';

const MetricCard = memo(function MetricCard({ icon: Icon, label, value, subValue, trend, color, delay }) {
  return (
    <div className={`metric-card animate-fade-in-up stagger-${delay}`}>
      <div className="metric-card-header">
        <div className={`metric-card-icon ${color}`}>
          <Icon size={22} strokeWidth={1.5} />
        </div>
        {trend && (
          <div className={`metric-card-trend ${trend > 0 ? 'positive' : 'negative'}`}>
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
});

const STATUS_CONFIG = {
  confirmed: { icon: CheckCircle, label: 'Confirmed', class: 'status-confirmed' },
  pending: { icon: AlertCircle, label: 'Pending', class: 'status-pending' },
  completed: { icon: CheckCircle, label: 'Completed', class: 'status-completed' },
  cancelled: { icon: XCircle, label: 'Cancelled', class: 'status-cancelled' },
  'no-show': { icon: XCircle, label: 'No Show', class: 'status-noshow' },
};

const BookingStatusBadge = memo(function BookingStatusBadge({ status }) {
  const { icon: Icon, label, class: className } = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  return (
    <span className={`booking-status ${className}`}>
      <Icon size={12} strokeWidth={2} />
      {label}
    </span>
  );
});

const TodayBookingItem = memo(function TodayBookingItem({ booking }) {
  return (
    <div className="today-booking-item">
      <div className="today-booking-time">
        <span className="today-booking-hour">{booking.time}</span>
        <span className="today-booking-duration">{booking.duration} min</span>
      </div>
      <div className="today-booking-details">
        <div className="today-booking-customer">{booking.customerName}</div>
        <div className="today-booking-service">
          {booking.serviceName} • {booking.barberName}
        </div>
      </div>
      <BookingStatusBadge status={booking.status} />
    </div>
  );
});

export default function Dashboard() {
  const { metrics, branchBookings, branchBarbers, branchServices, selectedBranch } = useApp();

  const today = new Date().toISOString().split('T')[0];

  const todayBookings = useMemo(() => {
    const barbersMap = new Map(branchBarbers.map(b => [b.id, b]));
    const servicesMap = new Map(branchServices.map(s => [s.id, s]));

    return branchBookings
      .filter(b => b.date === today)
      .map(booking => {
        const barber = barbersMap.get(booking.barberId);
        const services = (booking.serviceIds || [])
          .map(id => servicesMap.get(id))
          .filter(Boolean);

        return {
          ...booking,
          barberName: barber?.name || 'Unknown',
          serviceName: services.map(s => s.name).join(', ') || 'No service',
        };
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [branchBookings, branchBarbers, branchServices, today]);

  const upcomingBookings = useMemo(() =>
    todayBookings.filter(b =>
      ['confirmed', 'pending'].includes(b.status)
    ),
    [todayBookings]
  );

  return (
    <div className="dashboard">
      {/* Welcome Section */}
      <div className="dashboard-welcome animate-fade-in">
        <div className="dashboard-welcome-content">
          <h2 className="dashboard-welcome-title">
            Good {getTimeOfDay()}
          </h2>
          <p className="dashboard-welcome-text">
            Here's what's happening at <span className="text-accent">{selectedBranch?.name}</span> today.
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
          label="Today's Bookings"
          value={metrics.todayTotal}
          subValue={`${metrics.todayCompleted} completed, ${metrics.todayUpcoming} upcoming`}
          color="accent"
          delay={1}
        />
        <MetricCard
          icon={DollarSign}
          label="Week Revenue"
          value={`${metrics.weekRevenue.toLocaleString()} KWD`}
          subValue={`From ${metrics.weekBookings} bookings`}
          trend={12}
          color="success"
          delay={2}
        />
        <MetricCard
          icon={Users}
          label="Active Barbers"
          value={metrics.totalBarbers}
          subValue="Currently on schedule"
          color="info"
          delay={3}
        />
        <MetricCard
          icon={Scissors}
          label="Services Offered"
          value={metrics.totalServices}
          subValue="Active services"
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
            <Link to="/bookings" className="dashboard-card-link">
              View All <ArrowRight size={14} strokeWidth={2} />
            </Link>
          </div>

          <div className="dashboard-card-content">
            {upcomingBookings.length > 0 ? (
              <div className="today-bookings-list">
                {upcomingBookings.slice(0, 6).map((booking) => (
                  <TodayBookingItem key={booking.id} booking={booking} />
                ))}
              </div>
            ) : (
              <div className="dashboard-empty-state">
                <Calendar size={40} strokeWidth={1} />
                <p>No upcoming bookings for today</p>
                <Link to="/bookings" className="btn btn-primary btn-sm">
                  <Plus size={16} strokeWidth={2} />
                  New Booking
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
              <Link to="/bookings" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Plus size={24} strokeWidth={1.5} />
                </div>
                <span>New Booking</span>
              </Link>
              <Link to="/barbers" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Users size={24} strokeWidth={1.5} />
                </div>
                <span>Add Barber</span>
              </Link>
              <Link to="/services" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Scissors size={24} strokeWidth={1.5} />
                </div>
                <span>New Service</span>
              </Link>
              <Link to="/branches" className="quick-action-btn">
                <div className="quick-action-icon">
                  <Calendar size={24} strokeWidth={1.5} />
                </div>
                <span>View Schedule</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Active Barbers */}
        <div className="dashboard-card barbers-overview animate-fade-in-up stagger-6">
          <div className="dashboard-card-header">
            <div className="dashboard-card-title">
              <Users size={20} strokeWidth={1.5} />
              <h3>Active Barbers</h3>
            </div>
            <Link to="/barbers" className="dashboard-card-link">
              Manage <ArrowRight size={14} strokeWidth={2} />
            </Link>
          </div>

          <div className="dashboard-card-content">
            <div className="barbers-mini-list">
              {branchBarbers.slice(0, 4).map((barber) => {
                const barberBookings = todayBookings.filter(b => b.barberId === barber.id);
                return (
                  <div key={barber.id} className="barber-mini-card">
                    <div className="barber-mini-avatar">
                      {barber.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="barber-mini-info">
                      <span className="barber-mini-name">{barber.name}</span>
                      <span className="barber-mini-stats">
                        {barberBookings.length} bookings today
                      </span>
                    </div>
                    <div className={`barber-mini-status ${barber.status}`}>
                      {barber.status === 'active' ? 'Available' : 'Busy'}
                    </div>
                  </div>
                );
              })}
            </div>
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
