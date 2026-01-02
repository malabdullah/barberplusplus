import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Shield,
  AlertTriangle,
  AlertOctagon,
  Lock,
  Unlock,
  LogIn,
  LogOut,
  Key,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Filter,
  Search,
  Clock,
  X,
  ArrowLeft,
} from 'lucide-react';
import { format, parseISO, isToday, isYesterday, startOfWeek, isWithinInterval } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { adminService } from '../../services/admin.service';
import { SECURITY_EVENT_TYPES, SEVERITY_CONFIG, AUDIT_ACTION_TYPES } from '../../constants/auditTypes';
import './AdminPages.css';
import './AuditPages.css';

// Icon mapping for security events (lowercase to match DB)
const SECURITY_ICONS = {
  login_success: LogIn,
  login_failure: AlertTriangle,
  logout: LogOut,
  password_reset_requested: Key,
  password_reset_completed: Key,
  permission_denied: AlertOctagon,
  suspicious_activity: AlertOctagon,
  session_expired: Clock,
  account_locked: Lock,
  account_unlocked: Unlock,
  security_event: Shield,
};

// Get severity class for an event
const getSeverityClass = (actionType) => {
  const config = SEVERITY_CONFIG[actionType];
  return config?.severity || 'info';
};

// Security event card component
const SecurityEventCard = memo(function SecurityEventCard({ event, t, dateLocale }) {
  const config = AUDIT_ACTION_TYPES[event.actionType] || { label: event.actionType, color: 'secondary' };
  const severity = getSeverityClass(event.actionType);
  const Icon = SECURITY_ICONS[event.actionType] || Shield;

  return (
    <div className={`timeline-event ${severity}`}>
      <div className="timeline-event-card">
        <div className="timeline-event-header">
          <Icon size={16} />
          <span className={`audit-action-badge ${config.color}`}>
            {t(`admin.audit.actions.${event.actionType}`, { defaultValue: config.label })}
          </span>
          <span className="timeline-event-time">
            {format(parseISO(event.createdAt), 'HH:mm:ss', { locale: dateLocale })}
          </span>
        </div>
        <div className="timeline-event-details">
          {event.targetUserId && (
            <span>User: {event.targetUserId.slice(0, 8)}...</span>
          )}
          {event.ipAddress && (
            <span> | IP: {event.ipAddress}</span>
          )}
          {event.metadata?.email && (
            <span> | {event.metadata.email}</span>
          )}
        </div>
      </div>
    </div>
  );
});

// Group events by date
const groupEventsByDate = (events, t) => {
  const groups = {};
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  events.forEach((event) => {
    const eventDate = parseISO(event.createdAt);
    let key;

    if (isToday(eventDate)) {
      key = 'today';
    } else if (isYesterday(eventDate)) {
      key = 'yesterday';
    } else if (isWithinInterval(eventDate, { start: weekStart, end: now })) {
      key = 'thisWeek';
    } else {
      key = 'older';
    }

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(event);
  });

  return groups;
};

export default function SecurityEvents() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    failedLogins24h: 0,
    permissionDenied24h: 0,
    suspiciousActivity7d: 0,
    passwordResets7d: 0,
    totalEvents: 0,
  });

  // Filters
  const [filters, setFilters] = useState({
    search: '',
    eventType: '',
    severity: '',
    startDate: '',
    endDate: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [activeSeverityFilter, setActiveSeverityFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const ITEMS_PER_PAGE = 50;

  // Load security events
  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminService.getSecurityEvents({
        page,
        limit: ITEMS_PER_PAGE,
        eventType: filters.eventType || null,
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
      });

      setEvents(result.events);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      console.error('Error loading security events:', error);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const result = await adminService.getSecurityStats(7);
      setStats(result);
    } catch (error) {
      console.error('Error loading security stats:', error);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Handle filter changes
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  // Handle severity filter pill click
  const handleSeverityFilter = (severity) => {
    if (activeSeverityFilter === severity) {
      setActiveSeverityFilter('');
      // Clear event type filter related to this severity
      setFilters((prev) => ({ ...prev, eventType: '' }));
    } else {
      setActiveSeverityFilter(severity);
      // Set event type filter based on severity (lowercase to match DB)
      let eventType = '';
      switch (severity) {
        case 'critical':
          eventType = 'suspicious_activity';
          break;
        case 'error':
          eventType = 'login_failure';
          break;
        case 'warning':
          eventType = 'password_reset_requested';
          break;
        default:
          eventType = '';
      }
      setFilters((prev) => ({ ...prev, eventType }));
    }
    setPage(1);
  };

  // Clear filters
  const clearFilters = () => {
    setFilters({
      search: '',
      eventType: '',
      severity: '',
      startDate: '',
      endDate: '',
    });
    setActiveSeverityFilter('');
    setPage(1);
  };

  // Filter events by search and severity (client-side)
  const filteredEvents = useMemo(() => {
    let result = events;

    if (filters.search) {
      const query = filters.search.toLowerCase();
      result = result.filter(
        (event) =>
          event.actionType?.toLowerCase().includes(query) ||
          event.ipAddress?.includes(query) ||
          event.metadata?.email?.toLowerCase().includes(query)
      );
    }

    if (activeSeverityFilter) {
      result = result.filter((event) => {
        const severity = getSeverityClass(event.actionType);
        return severity === activeSeverityFilter;
      });
    }

    return result;
  }, [events, filters.search, activeSeverityFilter]);

  // Group events by date for timeline view
  const groupedEvents = useMemo(() => {
    return groupEventsByDate(filteredEvents, t);
  }, [filteredEvents, t]);

  // Calculate showing range
  const showingFrom = total > 0 ? (page - 1) * ITEMS_PER_PAGE + 1 : 0;
  const showingTo = Math.min(page * ITEMS_PER_PAGE, total);

  return (
    <div className="audit-page">
      {/* Back Link */}
      <Link to="/admin/audit" className="audit-back-link">
        <ArrowLeft size={16} />
        {t('admin.audit.title')}
      </Link>

      {/* Page Header */}
      <div className="audit-page-header animate-fade-in">
        <div className="audit-page-header-content">
          <h1 className="audit-page-title">{t('admin.audit.security')}</h1>
          <p className="audit-page-description">{t('admin.audit.securitySubtitle')}</p>
        </div>
        <div className="audit-page-actions">
          <button
            className="btn btn-secondary"
            onClick={() => { loadEvents(); loadStats(); }}
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="audit-stats animate-fade-in-up stagger-1">
        <div className="audit-stat-card error">
          <AlertTriangle size={24} />
          <div className="audit-stat-content">
            <span className="audit-stat-value">{stats.failedLogins24h}</span>
            <span className="audit-stat-label">{t('admin.audit.stats.failedLogins')}</span>
            <span className="audit-stat-sublabel">{t('admin.audit.stats.last24h')}</span>
          </div>
        </div>
        <div className="audit-stat-card error">
          <AlertOctagon size={24} />
          <div className="audit-stat-content">
            <span className="audit-stat-value">{stats.permissionDenied24h}</span>
            <span className="audit-stat-label">{t('admin.audit.stats.permissionDenied')}</span>
            <span className="audit-stat-sublabel">{t('admin.audit.stats.last24h')}</span>
          </div>
        </div>
        <div className="audit-stat-card warning">
          <Shield size={24} />
          <div className="audit-stat-content">
            <span className="audit-stat-value">{stats.suspiciousActivity7d}</span>
            <span className="audit-stat-label">{t('admin.audit.stats.suspiciousActivity')}</span>
            <span className="audit-stat-sublabel">{t('admin.audit.stats.last7d')}</span>
          </div>
        </div>
        <div className="audit-stat-card info">
          <Key size={24} />
          <div className="audit-stat-content">
            <span className="audit-stat-value">{stats.passwordResets7d}</span>
            <span className="audit-stat-label">{t('admin.audit.stats.passwordResets')}</span>
            <span className="audit-stat-sublabel">{t('admin.audit.stats.last7d')}</span>
          </div>
        </div>
      </div>

      {/* Severity Filter Pills */}
      <div className="severity-filter-pills animate-fade-in-up stagger-2">
        <button
          className={`severity-pill ${activeSeverityFilter === '' ? 'active' : ''}`}
          onClick={() => handleSeverityFilter('')}
        >
          All Events
          <span className="severity-pill-count">{stats.totalEvents}</span>
        </button>
        <button
          className={`severity-pill critical ${activeSeverityFilter === 'critical' ? 'active' : ''}`}
          onClick={() => handleSeverityFilter('critical')}
        >
          {t('admin.audit.severity.critical')}
        </button>
        <button
          className={`severity-pill error ${activeSeverityFilter === 'error' ? 'active' : ''}`}
          onClick={() => handleSeverityFilter('error')}
        >
          {t('admin.audit.severity.error')}
        </button>
        <button
          className={`severity-pill warning ${activeSeverityFilter === 'warning' ? 'active' : ''}`}
          onClick={() => handleSeverityFilter('warning')}
        >
          {t('admin.audit.severity.warning')}
        </button>
      </div>

      {/* Search and Toolbar */}
      <div className="audit-toolbar animate-fade-in-up stagger-2">
        <div className="audit-search">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('admin.audit.filters.search', { defaultValue: 'Search events...' })}
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className="audit-search-input"
          />
        </div>
        <button
          className={`btn btn-secondary ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} />
          {t('common.filters')}
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="audit-filters animate-fade-in-up">
          <div className="audit-filter-group">
            <label>{t('admin.audit.filters.eventType', { defaultValue: 'Event Type' })}</label>
            <select
              value={filters.eventType}
              onChange={(e) => handleFilterChange('eventType', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('admin.audit.filters.allEvents', { defaultValue: 'All Events' })}</option>
              {SECURITY_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {AUDIT_ACTION_TYPES[type]?.label || type}
                </option>
              ))}
            </select>
          </div>
          <div className="audit-filter-group">
            <label>{t('admin.audit.filters.startDate')}</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              onClick={(e) => e.target.showPicker()}
              className="form-input"
            />
          </div>
          <div className="audit-filter-group">
            <label>{t('admin.audit.filters.endDate')}</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              onClick={(e) => e.target.showPicker()}
              className="form-input"
            />
          </div>
          <button className="btn btn-text" onClick={clearFilters}>
            <X size={16} />
            {t('admin.audit.filters.clear')}
          </button>
        </div>
      )}

      {/* Events Timeline */}
      <div className="audit-logs-container animate-fade-in-up stagger-3">
        {loading ? (
          <div className="audit-loading">
            <RefreshCw size={24} className="spin" />
            <span>{t('admin.audit.loading.events')}</span>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="audit-empty">
            <Shield size={48} strokeWidth={1} />
            <h3>{t('admin.audit.empty.noEvents')}</h3>
            <p>{t('admin.audit.empty.noEventsDesc')}</p>
          </div>
        ) : (
          <>
            <div className="security-timeline" style={{ padding: 'var(--space-lg)' }}>
              {Object.entries(groupedEvents).map(([dateKey, dateEvents]) => (
                <div key={dateKey} className="timeline-date-group">
                  <div className="timeline-date-header">
                    {t(`admin.audit.timeline.${dateKey}`, { defaultValue: dateKey })}
                  </div>
                  {dateEvents.map((event) => (
                    <SecurityEventCard
                      key={event.id}
                      event={event}
                      t={t}
                      dateLocale={dateLocale}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="audit-pagination">
                <span className="audit-pagination-info">
                  {t('admin.audit.pagination.showing', {
                    from: showingFrom,
                    to: showingTo,
                    total,
                  })}
                </span>
                <div className="audit-pagination-controls">
                  <button
                    className="audit-pagination-btn"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft size={16} />
                    {t('admin.audit.pagination.previous')}
                  </button>
                  <span className="audit-page-indicator">
                    {t('admin.audit.pagination.page', { current: page, total: totalPages })}
                  </span>
                  <button
                    className="audit-pagination-btn"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    {t('admin.audit.pagination.next')}
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
