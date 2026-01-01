import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DollarSign,
  Calendar,
  Users,
  Scissors,
  Clock,
  AlertCircle,
  RefreshCw,
  Loader2,
  BarChart3
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { adminService } from '../../services/admin.service';
import { AnalyticsMetricCard, SkeletonChart } from '../../components/Analytics';
import './PlatformAnalytics.css';
import './AdminPages.css';

// Time period options
const TIME_PERIODS = [
  { key: 'today', labelKey: 'admin.analytics.today' },
  { key: 'this_week', labelKey: 'admin.analytics.thisWeek' },
  { key: 'this_month', labelKey: 'admin.analytics.thisMonth' },
  { key: 'last_30_days', labelKey: 'admin.analytics.last30Days' },
  { key: 'last_90_days', labelKey: 'admin.analytics.last90Days' },
];

// Chart colors
const STATUS_COLORS = {
  completed: '#22c55e',
  cancelled: '#ef4444',
  no_show: '#f59e0b',
  pending: '#6366f1',
  confirmed: '#3b82f6',
};

const CHART_COLORS = ['#D4A853', '#22c55e', '#3b82f6', '#8b5cf6', '#f59e0b'];

// Custom tooltip component
const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip-label">{label}</div>
      {payload.map((entry, index) => (
        <div key={index} className="analytics-tooltip-value" style={{ color: entry.color }}>
          {entry.name}: {formatter ? formatter(entry.value) : entry.value}
        </div>
      ))}
    </div>
  );
};

export default function PlatformAnalytics() {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState('this_week');
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState(null);
  const [timeSeries, setTimeSeries] = useState([]);
  const [error, setError] = useState(null);

  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const isRTL = i18n.language === 'ar';

  // Load analytics data
  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [analyticsData, timeSeriesData] = await Promise.all([
        adminService.getAnalytics(period),
        adminService.getRevenueTimeSeries(period),
      ]);
      setAnalytics(analyticsData);
      setTimeSeries(timeSeriesData);
    } catch (err) {
      console.error('Failed to load analytics:', err);
      setError(err.message || t('admin.analytics.error'));
    } finally {
      setLoading(false);
    }
  }, [period, t]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Transform booking status data for pie chart
  const statusPieData = useMemo(() => {
    if (!analytics?.bookingsByStatus) return [];

    return Object.entries(analytics.bookingsByStatus)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => ({
        name: t(`admin.analytics.statusLabels.${key}`),
        value,
        color: STATUS_COLORS[key] || '#888',
      }));
  }, [analytics, t]);

  // Format date for chart axis
  const formatChartDate = useCallback((dateStr) => {
    try {
      const date = new Date(dateStr);
      // For longer periods, show shorter format
      if (period === 'last_90_days' || period === 'last_30_days') {
        return format(date, 'MMM d', { locale: dateLocale });
      }
      return format(date, 'EEE', { locale: dateLocale });
    } catch {
      return dateStr;
    }
  }, [period, dateLocale]);

  // Format currency
  const formatCurrency = useCallback((value) => {
    return `${value.toLocaleString()} ${t('common.currency', 'KWD')}`;
  }, [t]);

  // Render loading skeleton
  if (loading && !analytics) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <h1>{t('admin.analytics.title')}</h1>
          <p>{t('admin.analytics.subtitle')}</p>
        </div>

        <div className="analytics-time-filter">
          {TIME_PERIODS.map(({ key, labelKey }) => (
            <button
              key={key}
              className={`analytics-period-btn ${period === key ? 'active' : ''}`}
              disabled
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        <div className="analytics-skeleton-metrics">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="analytics-skeleton-metric" />
          ))}
        </div>

        <div className="analytics-charts-grid">
          <div className="analytics-chart-card full-width">
            <h3>{t('admin.analytics.revenueOverTime')}</h3>
            <SkeletonChart height={300} />
          </div>
          <div className="analytics-chart-card">
            <h3>{t('admin.analytics.bookingsByStatus')}</h3>
            <SkeletonChart height={250} />
          </div>
          <div className="analytics-chart-card">
            <h3>{t('admin.analytics.peakBookingHours')}</h3>
            <SkeletonChart height={250} />
          </div>
        </div>
      </div>
    );
  }

  // Render error state
  if (error && !analytics) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <h1>{t('admin.analytics.title')}</h1>
          <p>{t('admin.analytics.subtitle')}</p>
        </div>

        <div className="analytics-error">
          <div className="analytics-error-icon">
            <AlertCircle size={28} />
          </div>
          <h3>{t('admin.analytics.error')}</h3>
          <p>{error}</p>
          <button className="analytics-retry-btn" onClick={loadAnalytics}>
            <RefreshCw size={16} />
            {t('common.retry', 'Retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>{t('admin.analytics.title')}</h1>
        <p>{t('admin.analytics.subtitle')}</p>
      </div>

      {/* Time Period Filter */}
      <div className="analytics-time-filter">
        {TIME_PERIODS.map(({ key, labelKey }) => (
          <button
            key={key}
            className={`analytics-period-btn ${period === key ? 'active' : ''}`}
            onClick={() => setPeriod(key)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Loading indicator for period change */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--text-secondary)' }}>
          <Loader2 size={16} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
          <span>{t('admin.analytics.loading')}</span>
        </div>
      )}

      {/* KPI Metrics Grid */}
      {analytics && (
        <div className="analytics-metrics-grid">
          <AnalyticsMetricCard
            icon={DollarSign}
            label={t('admin.analytics.totalRevenue')}
            value={formatCurrency(analytics.kpis.totalRevenue)}
            trend={analytics.kpis.revenueTrend}
            subValue={t('admin.analytics.vsPreviousPeriod')}
            color="success"
            delay={1}
          />
          <AnalyticsMetricCard
            icon={Calendar}
            label={t('admin.analytics.totalBookings')}
            value={analytics.kpis.totalBookings.toLocaleString()}
            trend={analytics.kpis.bookingsTrend}
            subValue={t('admin.analytics.vsPreviousPeriod')}
            color="accent"
            delay={2}
          />
          <AnalyticsMetricCard
            icon={DollarSign}
            label={t('admin.analytics.avgBookingValue')}
            value={formatCurrency(analytics.kpis.avgBookingValue)}
            color="info"
            delay={3}
          />
          <AnalyticsMetricCard
            icon={Users}
            label={t('admin.analytics.activeBarbers')}
            value={analytics.kpis.activeBarbers.toString()}
            subValue={`${analytics.kpis.totalServices} ${t('admin.analytics.totalServices')}`}
            color="purple"
            delay={4}
          />
        </div>
      )}

      {/* Charts Grid */}
      {analytics && (
        <div className="analytics-charts-grid">
          {/* Revenue Over Time - Line Chart */}
          <div className="analytics-chart-card full-width">
            <h3>{t('admin.analytics.revenueOverTime')}</h3>
            <div className="analytics-chart-wrapper">
              {timeSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeSeries} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(212, 168, 83, 0.1)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatChartDate}
                      stroke="var(--text-tertiary)"
                      fontSize={12}
                      tickMargin={10}
                    />
                    <YAxis
                      stroke="var(--text-tertiary)"
                      fontSize={12}
                      tickFormatter={(v) => v.toLocaleString()}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => (
                        <CustomTooltip
                          active={active}
                          payload={payload}
                          label={formatChartDate(label)}
                          formatter={formatCurrency}
                        />
                      )}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      name={t('admin.analytics.totalRevenue')}
                      stroke="#D4A853"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6, fill: '#D4A853' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="analytics-empty">
                  <BarChart3 size={40} className="analytics-empty-icon" />
                  <p>{t('admin.analytics.noData')}</p>
                </div>
              )}
            </div>
          </div>

          {/* Bookings by Status - Pie Chart */}
          <div className="analytics-chart-card">
            <h3>{t('admin.analytics.bookingsByStatus')}</h3>
            <div className="analytics-chart-wrapper small">
              {statusPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {statusPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="analytics-tooltip">
                            <div className="analytics-tooltip-label">{data.name}</div>
                            <div className="analytics-tooltip-value">{data.value} {t('admin.analytics.bookings', 'bookings')}</div>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      formatter={(value) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="analytics-empty">
                  <BarChart3 size={40} className="analytics-empty-icon" />
                  <p>{t('admin.analytics.noData')}</p>
                </div>
              )}
            </div>
          </div>

          {/* Peak Booking Hours - Bar Chart */}
          <div className="analytics-chart-card">
            <h3>{t('admin.analytics.peakBookingHours')}</h3>
            <div className="analytics-chart-wrapper small">
              {analytics.peakHours.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.peakHours} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(212, 168, 83, 0.1)" />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={(h) => `${h}:00`}
                      stroke="var(--text-tertiary)"
                      fontSize={11}
                    />
                    <YAxis stroke="var(--text-tertiary)" fontSize={12} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        return (
                          <div className="analytics-tooltip">
                            <div className="analytics-tooltip-label">{label}:00</div>
                            <div className="analytics-tooltip-value">{payload[0].value} {t('admin.analytics.bookings', 'bookings')}</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="count" fill="#D4A853" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="analytics-empty">
                  <Clock size={40} className="analytics-empty-icon" />
                  <p>{t('admin.analytics.noData')}</p>
                </div>
              )}
            </div>
          </div>

          {/* Top Barbers by Revenue - Horizontal Bar Chart */}
          <div className="analytics-chart-card">
            <h3>{t('admin.analytics.topBarbersByRevenue')}</h3>
            <div className="analytics-chart-wrapper small">
              {analytics.barberPerformance.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={analytics.barberPerformance.slice(0, 5)}
                    layout="vertical"
                    margin={{ top: 5, right: 20, left: 60, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(212, 168, 83, 0.1)" />
                    <XAxis
                      type="number"
                      stroke="var(--text-tertiary)"
                      fontSize={12}
                      tickFormatter={(v) => v.toLocaleString()}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={55}
                      stroke="var(--text-tertiary)"
                      fontSize={11}
                      tickFormatter={(name) => name.length > 8 ? `${name.slice(0, 8)}...` : name}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="analytics-tooltip">
                            <div className="analytics-tooltip-label">{data.name}</div>
                            <div className="analytics-tooltip-value">{formatCurrency(data.revenue)}</div>
                            <div className="analytics-tooltip-value">{data.totalBookings} {t('admin.analytics.bookings', 'bookings')}</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="revenue" fill="#22c55e" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="analytics-empty">
                  <Users size={40} className="analytics-empty-icon" />
                  <p>{t('admin.analytics.noData')}</p>
                </div>
              )}
            </div>
          </div>

          {/* Popular Services - Bar Chart */}
          <div className="analytics-chart-card">
            <h3>{t('admin.analytics.popularServices')}</h3>
            <div className="analytics-chart-wrapper small">
              {analytics.serviceAnalysis.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={analytics.serviceAnalysis.slice(0, 5)}
                    margin={{ top: 5, right: 20, left: 10, bottom: 50 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(212, 168, 83, 0.1)" />
                    <XAxis
                      dataKey="name"
                      stroke="var(--text-tertiary)"
                      fontSize={10}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                      tickFormatter={(name) => name.length > 12 ? `${name.slice(0, 12)}...` : name}
                    />
                    <YAxis stroke="var(--text-tertiary)" fontSize={12} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="analytics-tooltip">
                            <div className="analytics-tooltip-label">{data.name}</div>
                            <div className="analytics-tooltip-value">{data.bookings} {t('admin.analytics.bookings', 'bookings')}</div>
                            <div className="analytics-tooltip-value">{formatCurrency(data.revenue)}</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="bookings" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="analytics-empty">
                  <Scissors size={40} className="analytics-empty-icon" />
                  <p>{t('admin.analytics.noData')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
