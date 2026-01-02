import React, { useState, useEffect, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Info,
  Bug,
  RefreshCw,
  Download,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { useApp } from '../context/AppContext';
import { loggingService } from '../services/logging.service';
import {
  LOG_LEVEL_CONFIG,
  LOG_TYPE_CONFIG,
  LOG_LEVELS,
  LOG_TYPES,
} from '../constants/logTypes';
import './Logs.css';

const ICONS = {
  AlertTriangle,
  AlertCircle,
  Info,
  Bug,
};

const LogLevelBadge = memo(function LogLevelBadge({ level }) {
  const config = LOG_LEVEL_CONFIG[level] || LOG_LEVEL_CONFIG.info;
  const Icon = ICONS[config.icon] || Info;

  return (
    <span className={`log-level-badge ${config.color}`}>
      <Icon size={12} strokeWidth={2} />
      {config.label}
    </span>
  );
});

const LogTypeBadge = memo(function LogTypeBadge({ type }) {
  const config = LOG_TYPE_CONFIG[type] || LOG_TYPE_CONFIG.system;
  return <span className={`log-type-badge ${config.color}`}>{config.label}</span>;
});

const LogRow = memo(function LogRow({ log, isExpanded, onToggle }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;

  return (
    <div className={`log-row ${isExpanded ? 'expanded' : ''}`}>
      <div className="log-row-main" onClick={onToggle}>
        <button className="log-expand-btn" type="button">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <span className="log-time">
          {format(new Date(log.createdAt), 'MMM d, HH:mm:ss', { locale: dateLocale })}
        </span>
        <LogLevelBadge level={log.level} />
        <LogTypeBadge type={log.logType} />
        <span className="log-message">{log.message}</span>
        {log.entityType && <span className="log-entity">{log.entityType}</span>}
      </div>

      {isExpanded && (
        <div className="log-details animate-fade-in">
          <div className="log-detail-grid">
            <div className="log-detail-item">
              <span className="log-detail-label">{t('logs.userId')}</span>
              <span className="log-detail-value">{log.userId || 'N/A'}</span>
            </div>
            <div className="log-detail-item">
              <span className="log-detail-label">{t('logs.role')}</span>
              <span className="log-detail-value">{log.userRole || 'N/A'}</span>
            </div>
            <div className="log-detail-item">
              <span className="log-detail-label">{t('logs.branchId')}</span>
              <span className="log-detail-value">
                {log.branchId ? log.branchId.slice(0, 8) + '...' : 'N/A'}
              </span>
            </div>
            <div className="log-detail-item">
              <span className="log-detail-label">{t('logs.action')}</span>
              <span className="log-detail-value">{log.action || 'N/A'}</span>
            </div>
            <div className="log-detail-item">
              <span className="log-detail-label">{t('logs.pageUrl')}</span>
              <span className="log-detail-value log-url">{log.pageUrl || 'N/A'}</span>
            </div>
            <div className="log-detail-item">
              <span className="log-detail-label">{t('logs.fullTimestamp')}</span>
              <span className="log-detail-value">
                {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss.SSS')}
              </span>
            </div>
          </div>

          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <div className="log-metadata">
              <span className="log-detail-label">{t('logs.metadata')}</span>
              <pre className="log-metadata-content">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </div>
          )}

          {log.stackTrace && (
            <div className="log-stack-trace">
              <span className="log-detail-label">{t('logs.stackTrace')}</span>
              <pre className="log-stack-content">{log.stackTrace}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default function Logs() {
  const { t } = useTranslation();
  const { selectedBranchId, branches } = useApp();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Filters
  const [filters, setFilters] = useState({
    search: '',
    level: '',
    logType: '',
    branchId: selectedBranchId || '',
    startDate: '',
    endDate: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const activeFilters = {};
      if (filters.search) activeFilters.search = filters.search;
      if (filters.level) activeFilters.level = filters.level;
      if (filters.logType) activeFilters.logType = filters.logType;
      if (filters.branchId) activeFilters.branchId = filters.branchId;
      if (filters.startDate) activeFilters.startDate = filters.startDate;
      if (filters.endDate) activeFilters.endDate = filters.endDate;

      const result = await loggingService.getAll(activeFilters);
      setLogs(result.logs);
    } catch (error) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

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

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      level: '',
      logType: '',
      branchId: '',
      startDate: '',
      endDate: '',
    });
  };

  const exportLogs = () => {
    const data = JSON.stringify(logs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Count logs by level for stats
  const stats = logs.reduce(
    (acc, log) => {
      acc[log.level] = (acc[log.level] || 0) + 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0, debug: 0 }
  );

  return (
    <div className="logs-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">{t('logs.title')}</h2>
          <p className="page-description">{t('logs.description')}</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={loadLogs} disabled={loading}>
            <RefreshCw size={18} strokeWidth={2} className={loading ? 'spin' : ''} />
            {t('logs.refresh')}
          </button>
          <button className="btn btn-secondary" onClick={exportLogs} disabled={logs.length === 0}>
            <Download size={18} strokeWidth={2} />
            {t('logs.export')}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="logs-stats animate-fade-in-up stagger-1">
        <div className="log-stat-card error">
          <AlertTriangle size={20} />
          <div className="log-stat-content">
            <span className="log-stat-value">{stats.error}</span>
            <span className="log-stat-label">{t('logs.errors')}</span>
          </div>
        </div>
        <div className="log-stat-card warning">
          <AlertCircle size={20} />
          <div className="log-stat-content">
            <span className="log-stat-value">{stats.warning}</span>
            <span className="log-stat-label">{t('logs.warnings')}</span>
          </div>
        </div>
        <div className="log-stat-card info">
          <Info size={20} />
          <div className="log-stat-content">
            <span className="log-stat-value">{stats.info}</span>
            <span className="log-stat-label">{t('logs.info')}</span>
          </div>
        </div>
        <div className="log-stat-card total">
          <FileText size={20} />
          <div className="log-stat-content">
            <span className="log-stat-value">{logs.length}</span>
            <span className="log-stat-label">{t('logs.total')}</span>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="logs-toolbar animate-fade-in-up stagger-2">
        <div className="logs-search">
          <Search size={18} strokeWidth={1.5} />
          <input
            type="text"
            placeholder={t('logs.searchLogs')}
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className="logs-search-input"
          />
        </div>
        <button
          className={`btn btn-secondary ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} strokeWidth={2} />
          {t('logs.filters')}
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="logs-filters animate-fade-in-up">
          <div className="filter-group">
            <label>{t('logs.level')}</label>
            <select
              value={filters.level}
              onChange={(e) => handleFilterChange('level', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('logs.allLevels')}</option>
              {LOG_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {LOG_LEVEL_CONFIG[level].label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>{t('logs.type')}</label>
            <select
              value={filters.logType}
              onChange={(e) => handleFilterChange('logType', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('logs.allTypes')}</option>
              {LOG_TYPES.map((type) => (
                <option key={type} value={type}>
                  {LOG_TYPE_CONFIG[type].label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>{t('logs.branch')}</label>
            <select
              value={filters.branchId}
              onChange={(e) => handleFilterChange('branchId', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('logs.allBranches')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>{t('logs.startDate')}</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              onClick={(e) => e.target.showPicker()}
              className="form-input"
            />
          </div>
          <div className="filter-group">
            <label>{t('logs.endDate')}</label>
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
            {t('logs.clear')}
          </button>
        </div>
      )}

      {/* Logs List */}
      <div className="logs-container animate-fade-in-up stagger-3">
        {loading ? (
          <div className="logs-loading">
            <RefreshCw size={24} className="spin" />
            <span>{t('logs.loadingLogs')}</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="logs-empty">
            <FileText size={48} strokeWidth={1} />
            <h3>{t('logs.noLogsFound')}</h3>
            <p>{t('logs.noLogsMatch')}</p>
          </div>
        ) : (
          <div className="logs-list">
            {logs.map((log) => (
              <LogRow
                key={log.id}
                log={log}
                isExpanded={expandedIds.has(log.id)}
                onToggle={() => toggleExpand(log.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
