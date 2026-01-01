import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Activity,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Download,
  X,
  FileText,
  Users,
  Settings,
  Shield,
  ArrowLeft,
  FileJson,
  FileSpreadsheet,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { adminService } from '../../services/admin.service';
import {
  AUDIT_ACTION_TYPES,
  AUDIT_ACTION_TYPE_LIST,
  AUDIT_ENTITY_TYPES,
} from '../../constants/auditTypes';
import './AdminPages.css';
import './AuditPages.css';

// Action badge component
const ActionBadge = memo(function ActionBadge({ actionType, t }) {
  const config = AUDIT_ACTION_TYPES[actionType] || { label: actionType, color: 'secondary' };
  return (
    <span className={`audit-action-badge ${config.color}`}>
      {t(`admin.audit.actions.${actionType}`, { defaultValue: config.label })}
    </span>
  );
});

// Generate summary text for a log entry
const generateSummary = (log, t) => {
  const parts = [];

  if (log.targetEntityType) {
    parts.push(log.targetEntityType);
  }
  if (log.targetEntityId) {
    parts.push(`#${String(log.targetEntityId).slice(0, 8)}...`);
  }
  if (log.metadata?.action) {
    parts.push(`(${log.metadata.action})`);
  }

  return parts.length > 0 ? parts.join(' ') : t('admin.audit.details.noDetails', { defaultValue: 'No additional details' });
};

// Audit log row component
const AuditLogRow = memo(function AuditLogRow({ log, isExpanded, onToggle, t, dateLocale }) {
  return (
    <div className={`audit-log-row ${isExpanded ? 'expanded' : ''}`}>
      <div className="audit-log-row-main" onClick={onToggle}>
        <button className="audit-log-expand-btn" type="button">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <span className="audit-log-time">
          {format(parseISO(log.createdAt), 'MMM d, HH:mm:ss', { locale: dateLocale })}
        </span>
        <ActionBadge actionType={log.actionType} t={t} />
        {log.targetEntityType && (
          <span className="audit-entity-badge">{log.targetEntityType}</span>
        )}
        <span className="audit-log-summary">{generateSummary(log, t)}</span>
      </div>

      {isExpanded && (
        <div className="audit-log-details animate-fade-in">
          <div className="audit-detail-grid">
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.audit.details.adminUser')}</span>
              <span className="audit-detail-value">
                {log.adminUserId ? `${log.adminUserId.slice(0, 8)}...` : 'N/A'}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.audit.details.targetUser')}</span>
              <span className="audit-detail-value">
                {log.targetUserId ? `${log.targetUserId.slice(0, 8)}...` : 'N/A'}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.audit.details.entityId')}</span>
              <span className="audit-detail-value">
                {log.targetEntityId || 'N/A'}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.audit.details.ipAddress')}</span>
              <span className="audit-detail-value">{log.ipAddress || 'N/A'}</span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.audit.details.userAgent')}</span>
              <span className="audit-detail-value" style={{ fontSize: '0.75rem' }}>
                {log.userAgent ? log.userAgent.slice(0, 50) + '...' : 'N/A'}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.audit.details.fullTimestamp')}</span>
              <span className="audit-detail-value">
                {format(parseISO(log.createdAt), 'yyyy-MM-dd HH:mm:ss.SSS')}
              </span>
            </div>
          </div>

          {/* Values diff viewer */}
          {(log.oldValues || log.newValues) && (
            <div className="audit-diff-viewer">
              {log.oldValues && (
                <div className="audit-diff-panel old">
                  <div className="audit-diff-title">{t('admin.audit.details.oldValues')}</div>
                  <pre className="audit-diff-content">
                    {JSON.stringify(log.oldValues, null, 2)}
                  </pre>
                </div>
              )}
              {log.newValues && (
                <div className="audit-diff-panel new">
                  <div className="audit-diff-title">{t('admin.audit.details.newValues')}</div>
                  <pre className="audit-diff-content">
                    {JSON.stringify(log.newValues, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Metadata */}
          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <div className="audit-metadata">
              <span className="audit-detail-label">{t('admin.audit.details.metadata')}</span>
              <pre className="audit-metadata-content">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default function ActivityLogs() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    userActions: 0,
    configActions: 0,
    securityEvents: 0,
  });
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Filters
  const [filters, setFilters] = useState({
    search: '',
    actionType: '',
    entityType: '',
    startDate: '',
    endDate: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const ITEMS_PER_PAGE = 25;

  // Export dropdown
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Load audit logs
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminService.getAuditLogs({
        page,
        limit: ITEMS_PER_PAGE,
        actionType: filters.actionType || null,
        entityType: filters.entityType || null,
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
      });

      setLogs(result.logs);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const result = await adminService.getAuditStats(7);
      setStats({
        total: result.total,
        userActions: result.userActions,
        configActions: result.configActions,
        securityEvents: result.securityEvents,
      });
    } catch (error) {
      console.error('Error loading audit stats:', error);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Toggle row expansion
  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Handle filter changes
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset to first page
  };

  // Clear filters
  const clearFilters = () => {
    setFilters({
      search: '',
      actionType: '',
      entityType: '',
      startDate: '',
      endDate: '',
    });
    setPage(1);
  };

  // Export logs
  const handleExport = async (exportFormat) => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const data = await adminService.exportAuditLogs({
        format: exportFormat,
        actionType: filters.actionType || null,
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
      });

      let blob;
      let filename;
      const timestamp = format(new Date(), 'yyyy-MM-dd-HHmmss');

      if (exportFormat === 'csv') {
        blob = new Blob([data], { type: 'text/csv' });
        filename = `audit-logs-${timestamp}.csv`;
      } else {
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `audit-logs-${timestamp}.json`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting logs:', error);
    } finally {
      setExporting(false);
    }
  };

  // Filter logs by search (client-side for instant feedback)
  const filteredLogs = useMemo(() => {
    if (!filters.search) return logs;
    const query = filters.search.toLowerCase();
    return logs.filter(
      (log) =>
        log.actionType?.toLowerCase().includes(query) ||
        log.targetEntityType?.toLowerCase().includes(query) ||
        log.targetEntityId?.toLowerCase().includes(query)
    );
  }, [logs, filters.search]);

  // Calculate showing range
  const showingFrom = (page - 1) * ITEMS_PER_PAGE + 1;
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
          <h1 className="audit-page-title">{t('admin.audit.activity')}</h1>
          <p className="audit-page-description">{t('admin.audit.activitySubtitle')}</p>
        </div>
        <div className="audit-page-actions">
          <button
            className="btn btn-secondary"
            onClick={() => { loadLogs(); loadStats(); }}
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
            {t('common.refresh')}
          </button>
          <div className="export-dropdown">
            <button
              className="btn btn-secondary"
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={exporting || logs.length === 0}
            >
              <Download size={18} />
              {exporting ? t('admin.audit.export.exporting') : t('common.export')}
            </button>
            {showExportMenu && (
              <div className="export-menu">
                <button className="export-menu-item" onClick={() => handleExport('json')}>
                  <FileJson size={16} />
                  {t('admin.audit.export.json')}
                </button>
                <button className="export-menu-item" onClick={() => handleExport('csv')}>
                  <FileSpreadsheet size={16} />
                  {t('admin.audit.export.csv')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="audit-stats animate-fade-in-up stagger-1">
        <div className="audit-stat-card primary">
          <Activity size={24} />
          <div className="audit-stat-content">
            <span className="audit-stat-value">{stats.total}</span>
            <span className="audit-stat-label">{t('admin.audit.stats.totalActions')}</span>
            <span className="audit-stat-sublabel">{t('admin.audit.stats.last7d')}</span>
          </div>
        </div>
        <div className="audit-stat-card info">
          <Users size={24} />
          <div className="audit-stat-content">
            <span className="audit-stat-value">{stats.userActions}</span>
            <span className="audit-stat-label">{t('admin.audit.stats.userChanges')}</span>
          </div>
        </div>
        <div className="audit-stat-card warning">
          <Settings size={24} />
          <div className="audit-stat-content">
            <span className="audit-stat-value">{stats.configActions}</span>
            <span className="audit-stat-label">{t('admin.audit.stats.configChanges')}</span>
          </div>
        </div>
        <div className="audit-stat-card error">
          <Shield size={24} />
          <div className="audit-stat-content">
            <span className="audit-stat-value">{stats.securityEvents}</span>
            <span className="audit-stat-label">{t('admin.audit.stats.securityEvents')}</span>
          </div>
        </div>
      </div>

      {/* Search and Toolbar */}
      <div className="audit-toolbar animate-fade-in-up stagger-2">
        <div className="audit-search">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('admin.audit.filters.search', { defaultValue: 'Search logs...' })}
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
            <label>{t('admin.audit.filters.actionType')}</label>
            <select
              value={filters.actionType}
              onChange={(e) => handleFilterChange('actionType', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('admin.audit.filters.allActions')}</option>
              {AUDIT_ACTION_TYPE_LIST.map((type) => (
                <option key={type} value={type}>
                  {AUDIT_ACTION_TYPES[type].label}
                </option>
              ))}
            </select>
          </div>
          <div className="audit-filter-group">
            <label>{t('admin.audit.filters.entityType')}</label>
            <select
              value={filters.entityType}
              onChange={(e) => handleFilterChange('entityType', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('admin.audit.filters.allEntities')}</option>
              {AUDIT_ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
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
              className="form-input"
            />
          </div>
          <div className="audit-filter-group">
            <label>{t('admin.audit.filters.endDate')}</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              className="form-input"
            />
          </div>
          <button className="btn btn-text" onClick={clearFilters}>
            <X size={16} />
            {t('admin.audit.filters.clear')}
          </button>
        </div>
      )}

      {/* Logs List */}
      <div className="audit-logs-container animate-fade-in-up stagger-3">
        {loading ? (
          <div className="audit-loading">
            <RefreshCw size={24} className="spin" />
            <span>{t('admin.audit.loading.logs')}</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="audit-empty">
            <FileText size={48} strokeWidth={1} />
            <h3>{t('admin.audit.empty.noLogs')}</h3>
            <p>{t('admin.audit.empty.noLogsDesc')}</p>
          </div>
        ) : (
          <>
            <div className="audit-logs-list">
              {filteredLogs.map((log) => (
                <AuditLogRow
                  key={log.id}
                  log={log}
                  isExpanded={expandedIds.has(log.id)}
                  onToggle={() => toggleExpand(log.id)}
                  t={t}
                  dateLocale={dateLocale}
                />
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
