import React, { useState, useEffect, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  FileText,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  ArrowLeft,
  X,
  Download,
  FileJson,
  FileSpreadsheet,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { adminService } from '../../services/admin.service';
import './AdminPages.css';
import './AuditPages.css';
import './WhatsAppPages.css';

// Log level badge component
const LogLevelBadge = memo(function LogLevelBadge({ level, t }) {
  const config = {
    debug: { color: 'secondary', Icon: Bug },
    info: { color: 'info', Icon: Info },
    warn: { color: 'warning', Icon: AlertTriangle },
    error: { color: 'error', Icon: AlertCircle },
  };
  const { color, Icon } = config[level] || config.info;
  return (
    <span className={`audit-action-badge ${color}`}>
      <Icon size={10} />
      {t(`admin.whatsapp.logLevel.${level}`, { defaultValue: level })}
    </span>
  );
});

// Log row component
const LogRow = memo(function LogRow({ log, isExpanded, onToggle, t, dateLocale }) {
  const truncatedMessage = log.message?.length > 80
    ? log.message.substring(0, 80) + '...'
    : log.message;

  return (
    <div className={`audit-log-row ${isExpanded ? 'expanded' : ''}`}>
      <div className="severity-indicator" data-level={log.logLevel}></div>
      <div className="audit-log-row-main" onClick={onToggle}>
        <button className="audit-log-expand-btn" type="button">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <span className="audit-log-time">
          {format(parseISO(log.createdAt), 'MMM d, HH:mm:ss', { locale: dateLocale })}
        </span>
        <LogLevelBadge level={log.logLevel} t={t} />
        {log.eventType && (
          <span className="audit-entity-badge">{log.eventType}</span>
        )}
        <span className="audit-log-summary">{truncatedMessage || '—'}</span>
      </div>

      {isExpanded && (
        <div className="audit-log-details animate-fade-in">
          <div className="audit-detail-grid">
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.eventType')}</span>
              <span className="audit-detail-value">{log.eventType || 'N/A'}</span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.phone')}</span>
              <span className="audit-detail-value">{log.phoneNumber || 'N/A'}</span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.conversationId')}</span>
              <span className="audit-detail-value" style={{ fontSize: '0.75rem' }}>
                {log.conversationId ? `${log.conversationId.slice(0, 8)}...` : 'N/A'}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.toolName')}</span>
              <span className="audit-detail-value">{log.toolName || 'N/A'}</span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.executionTime')}</span>
              <span className="audit-detail-value">
                {log.executionTimeMs ? `${log.executionTimeMs}ms` : 'N/A'}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.audit.details.fullTimestamp')}</span>
              <span className="audit-detail-value">
                {format(parseISO(log.createdAt), 'yyyy-MM-dd HH:mm:ss.SSS')}
              </span>
            </div>
          </div>

          {/* Full Message */}
          <div className="whatsapp-full-content">
            <span className="audit-detail-label">{t('admin.whatsapp.fullMessage')}</span>
            <div className="whatsapp-content-box">
              {log.message || t('admin.whatsapp.noMessage')}
            </div>
          </div>

          {/* Error Details */}
          {(log.errorCode || log.errorMessage) && (
            <div className="whatsapp-error-section">
              <span className="audit-detail-label">{t('admin.whatsapp.errorDetails')}</span>
              <div className="whatsapp-error-box">
                {log.errorCode && (
                  <div className="whatsapp-error-code">
                    <strong>{t('admin.whatsapp.errorCode')}:</strong> {log.errorCode}
                  </div>
                )}
                {log.errorMessage && (
                  <div className="whatsapp-error-message">{log.errorMessage}</div>
                )}
              </div>
            </div>
          )}

          {/* Stack Trace */}
          {log.stackTrace && (
            <details className="whatsapp-stacktrace-section">
              <summary>{t('admin.whatsapp.stackTrace')}</summary>
              <pre className="whatsapp-stacktrace">{log.stackTrace}</pre>
            </details>
          )}

          {/* Tool Input/Output */}
          {(log.toolInput || log.toolOutput) && (
            <div className="audit-diff-viewer">
              {log.toolInput && (
                <div className="audit-diff-panel old">
                  <div className="audit-diff-title">{t('admin.whatsapp.toolInput')}</div>
                  <pre className="audit-diff-content">
                    {typeof log.toolInput === 'object'
                      ? JSON.stringify(log.toolInput, null, 2)
                      : log.toolInput}
                  </pre>
                </div>
              )}
              {log.toolOutput && (
                <div className="audit-diff-panel new">
                  <div className="audit-diff-title">{t('admin.whatsapp.toolOutput')}</div>
                  <pre className="audit-diff-content">
                    {typeof log.toolOutput === 'object'
                      ? JSON.stringify(log.toolOutput, null, 2)
                      : log.toolOutput}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Context Snapshot */}
          {log.contextSnapshot && Object.keys(log.contextSnapshot).length > 0 && (
            <details className="whatsapp-context-section">
              <summary>{t('admin.whatsapp.contextSnapshot')}</summary>
              <pre className="whatsapp-context-json">
                {JSON.stringify(log.contextSnapshot, null, 2)}
              </pre>
            </details>
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

export default function WhatsAppLogs() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventTypes, setEventTypes] = useState([]);
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Filters
  const [filters, setFilters] = useState({
    logLevel: '',
    eventType: '',
    startDate: '',
    endDate: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const ITEMS_PER_PAGE = 25;

  // Export
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Load logs
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminService.getWhatsAppLogs({
        page,
        limit: ITEMS_PER_PAGE,
        logLevel: filters.logLevel || null,
        eventType: filters.eventType || null,
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
      });

      setLogs(result.logs);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  // Load filter options
  const loadFilterOptions = useCallback(async () => {
    try {
      const types = await adminService.getWhatsAppEventTypes();
      setEventTypes(types);
    } catch (error) {
      console.error('Error loading event types:', error);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

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
    setPage(1);
  };

  // Clear filters
  const clearFilters = () => {
    setFilters({ logLevel: '', eventType: '', startDate: '', endDate: '' });
    setPage(1);
  };

  // Export logs
  const handleExport = async (exportFormat) => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const data = await adminService.exportWhatsAppLogs({
        format: exportFormat,
        logLevel: filters.logLevel || null,
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
      });

      let blob;
      let filename;
      const timestamp = format(new Date(), 'yyyy-MM-dd-HHmmss');

      if (exportFormat === 'csv') {
        blob = new Blob([data], { type: 'text/csv' });
        filename = `whatsapp-logs-${timestamp}.csv`;
      } else {
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `whatsapp-logs-${timestamp}.json`;
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

  const showingFrom = (page - 1) * ITEMS_PER_PAGE + 1;
  const showingTo = Math.min(page * ITEMS_PER_PAGE, total);

  return (
    <div className="audit-page">
      {/* Back Link */}
      <Link to="/admin/whatsapp" className="audit-back-link">
        <ArrowLeft size={16} />
        {t('admin.whatsapp.title')}
      </Link>

      {/* Page Header */}
      <div className="audit-page-header animate-fade-in">
        <div className="audit-page-header-content">
          <h1 className="audit-page-title">{t('admin.whatsapp.logs')}</h1>
          <p className="audit-page-description">{t('admin.whatsapp.logsSubtitle')}</p>
        </div>
        <div className="audit-page-actions">
          <button
            className="btn btn-secondary"
            onClick={loadLogs}
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

      {/* Log Level Filter Pills */}
      <div className="severity-filter-pills animate-fade-in-up stagger-1">
        <button
          className={`severity-pill ${filters.logLevel === '' ? 'active' : ''}`}
          onClick={() => handleFilterChange('logLevel', '')}
        >
          {t('admin.whatsapp.allLevels')}
        </button>
        <button
          className={`severity-pill ${filters.logLevel === 'error' ? 'active error' : ''}`}
          onClick={() => handleFilterChange('logLevel', 'error')}
        >
          <AlertCircle size={14} />
          {t('admin.whatsapp.logLevel.error')}
        </button>
        <button
          className={`severity-pill ${filters.logLevel === 'warn' ? 'active warning' : ''}`}
          onClick={() => handleFilterChange('logLevel', 'warn')}
        >
          <AlertTriangle size={14} />
          {t('admin.whatsapp.logLevel.warn')}
        </button>
        <button
          className={`severity-pill ${filters.logLevel === 'info' ? 'active' : ''}`}
          onClick={() => handleFilterChange('logLevel', 'info')}
        >
          <Info size={14} />
          {t('admin.whatsapp.logLevel.info')}
        </button>
        <button
          className={`severity-pill ${filters.logLevel === 'debug' ? 'active' : ''}`}
          onClick={() => handleFilterChange('logLevel', 'debug')}
        >
          <Bug size={14} />
          {t('admin.whatsapp.logLevel.debug')}
        </button>
      </div>

      {/* Additional Filters Toggle */}
      <div className="audit-toolbar animate-fade-in-up stagger-2">
        <button
          className={`btn btn-secondary ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} />
          {t('admin.whatsapp.moreFilters')}
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="audit-filters animate-fade-in-up">
          <div className="audit-filter-group">
            <label>{t('admin.whatsapp.filterEventType')}</label>
            <select
              value={filters.eventType}
              onChange={(e) => handleFilterChange('eventType', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('admin.whatsapp.allEventTypes')}</option>
              {eventTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
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

      {/* Logs List */}
      <div className="audit-logs-container animate-fade-in-up stagger-3">
        {loading ? (
          <div className="audit-loading">
            <RefreshCw size={24} className="spin" />
            <span>{t('admin.whatsapp.loadingLogs')}</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="audit-empty">
            <FileText size={48} strokeWidth={1} />
            <h3>{t('admin.whatsapp.noLogsFound')}</h3>
            <p>{t('admin.whatsapp.noLogsDesc')}</p>
          </div>
        ) : (
          <>
            <div className="audit-logs-list">
              {logs.map((log) => (
                <LogRow
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
