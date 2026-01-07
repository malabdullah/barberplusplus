import React, { useState, useEffect, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  MessageCircle,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  ArrowLeft,
  X,
  Trash2,
  ArrowDownLeft,
  ArrowUpRight,
  Phone,
  CheckSquare,
  Square,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { adminService } from '../../services/admin.service';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import './AdminPages.css';
import './AuditPages.css';
import './WhatsAppPages.css';

// Direction badge component
const DirectionBadge = memo(function DirectionBadge({ direction, t }) {
  const isInbound = direction === 'inbound';
  return (
    <span className={`whatsapp-direction-badge ${direction}`}>
      {isInbound ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
      {t(`admin.whatsapp.direction.${direction}`, { defaultValue: direction })}
    </span>
  );
});

// Status badge component
const StatusBadge = memo(function StatusBadge({ status, t }) {
  const colorMap = {
    sent: 'info',
    delivered: 'success',
    read: 'success',
    failed: 'error',
  };
  const color = colorMap[status] || 'secondary';
  return (
    <span className={`audit-action-badge ${color}`}>
      {t(`admin.whatsapp.status.${status}`, { defaultValue: status })}
    </span>
  );
});

// Message row component
const MessageRow = memo(function MessageRow({
  message,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onDelete,
  t,
  dateLocale,
}) {
  const truncatedContent = message.content?.length > 80
    ? message.content.substring(0, 80) + '...'
    : message.content;

  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    onSelect(message.id);
  };

  return (
    <div className={`audit-log-row ${isExpanded ? 'expanded' : ''} ${isSelected ? 'selected' : ''}`}>
      <div className="audit-log-row-main" onClick={onToggle}>
        <button
          className="whatsapp-checkbox-btn"
          type="button"
          onClick={handleCheckboxClick}
        >
          {isSelected ? (
            <CheckSquare size={18} className="whatsapp-checkbox checked" />
          ) : (
            <Square size={18} className="whatsapp-checkbox" />
          )}
        </button>
        <button className="audit-log-expand-btn" type="button">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <span className="audit-log-time">
          {format(parseISO(message.createdAt), 'MMM d, HH:mm:ss', { locale: dateLocale })}
        </span>
        <DirectionBadge direction={message.direction} t={t} />
        {message.status && <StatusBadge status={message.status} t={t} />}
        <span className="audit-log-summary">{truncatedContent || '—'}</span>
      </div>

      {isExpanded && (
        <div className="audit-log-details animate-fade-in">
          <div className="audit-detail-grid">
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.messageId')}</span>
              <span className="audit-detail-value" style={{ fontSize: '0.75rem' }}>
                {message.whatsappMessageId || 'N/A'}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.messageType')}</span>
              <span className="audit-detail-value">{message.messageType || 'text'}</span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.phone')}</span>
              <span className="audit-detail-value">
                {message.phoneNumber || 'N/A'}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.customer')}</span>
              <span className="audit-detail-value">
                {message.customerName || t('admin.whatsapp.unknownCustomer')}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.whatsapp.conversationId')}</span>
              <span className="audit-detail-value" style={{ fontSize: '0.75rem' }}>
                {message.conversationId ? `${message.conversationId.slice(0, 8)}...` : 'N/A'}
              </span>
            </div>
            <div className="audit-detail-item">
              <span className="audit-detail-label">{t('admin.audit.details.fullTimestamp')}</span>
              <span className="audit-detail-value">
                {format(parseISO(message.createdAt), 'yyyy-MM-dd HH:mm:ss.SSS')}
              </span>
            </div>
          </div>

          {/* Full Content */}
          <div className="whatsapp-full-content">
            <span className="audit-detail-label">{t('admin.whatsapp.fullContent')}</span>
            <div className="whatsapp-content-box">
              {message.content || t('admin.whatsapp.noContent')}
            </div>
          </div>

          {/* Metadata */}
          {message.metadata && Object.keys(message.metadata).length > 0 && (
            <div className="audit-metadata">
              <span className="audit-detail-label">{t('admin.audit.details.metadata')}</span>
              <pre className="audit-metadata-content">
                {JSON.stringify(message.metadata, null, 2)}
              </pre>
            </div>
          )}

          {/* Delete Button */}
          <div className="whatsapp-message-actions">
            <button
              className="btn btn-danger btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(message);
              }}
            >
              <Trash2 size={14} />
              {t('admin.whatsapp.deleteMessage')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default function WhatsAppMessages() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Filters
  const [filters, setFilters] = useState({
    search: '',
    direction: '',
    status: '',
    phoneNumber: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const ITEMS_PER_PAGE = 25;

  // Delete confirmation (single)
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk delete confirmation
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Load messages
  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminService.getWhatsAppMessages({
        page,
        limit: ITEMS_PER_PAGE,
        direction: filters.direction || null,
        status: filters.status || null,
        phoneNumber: filters.phoneNumber || null,
      });

      setMessages(result.messages);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      // Clear selection when loading new data
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoading(false);
    }
  }, [page, filters.direction, filters.status, filters.phoneNumber]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

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

  // Toggle selection
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all / deselect all
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredMessages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMessages.map((m) => m.id)));
    }
  };

  // Handle filter changes
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    if (key !== 'search') {
      setPage(1);
    }
  };

  // Clear filters
  const clearFilters = () => {
    setFilters({ search: '', direction: '', status: '', phoneNumber: '' });
    setPage(1);
  };

  // Delete single message
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminService.deleteWhatsAppMessage(deleteTarget.id);
      setMessages((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      setTotal((prev) => prev - 1);
      setDeleteTarget(null);
    } catch (error) {
      console.error('Error deleting message:', error);
    } finally {
      setDeleting(false);
    }
  };

  // Bulk delete messages
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const idsToDelete = Array.from(selectedIds);
      await adminService.deleteWhatsAppMessages(idsToDelete);
      setMessages((prev) => prev.filter((m) => !selectedIds.has(m.id)));
      setTotal((prev) => prev - selectedIds.size);
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
    } catch (error) {
      console.error('Error bulk deleting messages:', error);
    } finally {
      setBulkDeleting(false);
    }
  };

  // Filter messages by search (client-side)
  const filteredMessages = filters.search
    ? messages.filter((m) =>
        m.content?.toLowerCase().includes(filters.search.toLowerCase()) ||
        m.phoneNumber?.includes(filters.search) ||
        m.customerName?.toLowerCase().includes(filters.search.toLowerCase())
      )
    : messages;

  const showingFrom = total > 0 ? (page - 1) * ITEMS_PER_PAGE + 1 : 0;
  const showingTo = Math.min(page * ITEMS_PER_PAGE, total);

  const isAllSelected = filteredMessages.length > 0 && selectedIds.size === filteredMessages.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < filteredMessages.length;

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
          <h1 className="audit-page-title">{t('admin.whatsapp.messages')}</h1>
          <p className="audit-page-description">{t('admin.whatsapp.messagesSubtitle')}</p>
        </div>
        <div className="audit-page-actions">
          <button
            className="btn btn-secondary"
            onClick={loadMessages}
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Search and Toolbar */}
      <div className="audit-toolbar animate-fade-in-up stagger-1">
        <div className="audit-search">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('admin.whatsapp.searchMessages')}
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
            <label>{t('admin.whatsapp.filterPhone')}</label>
            <div className="audit-filter-input-wrapper">
              <Phone size={16} className="audit-filter-input-icon" />
              <input
                type="text"
                value={filters.phoneNumber}
                onChange={(e) => handleFilterChange('phoneNumber', e.target.value)}
                placeholder="965..."
                className="form-input audit-filter-input-with-icon"
              />
            </div>
          </div>
          <div className="audit-filter-group">
            <label>{t('admin.whatsapp.filterDirection')}</label>
            <select
              value={filters.direction}
              onChange={(e) => handleFilterChange('direction', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('admin.whatsapp.allDirections')}</option>
              <option value="inbound">{t('admin.whatsapp.direction.inbound')}</option>
              <option value="outbound">{t('admin.whatsapp.direction.outbound')}</option>
            </select>
          </div>
          <div className="audit-filter-group">
            <label>{t('admin.whatsapp.filterStatus')}</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('admin.whatsapp.allStatuses')}</option>
              <option value="sent">{t('admin.whatsapp.status.sent')}</option>
              <option value="delivered">{t('admin.whatsapp.status.delivered')}</option>
              <option value="read">{t('admin.whatsapp.status.read')}</option>
              <option value="failed">{t('admin.whatsapp.status.failed')}</option>
            </select>
          </div>
          <button className="btn btn-text" onClick={clearFilters}>
            <X size={16} />
            {t('admin.audit.filters.clear')}
          </button>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {filteredMessages.length > 0 && (
        <div className="whatsapp-bulk-actions animate-fade-in-up stagger-2">
          <button
            className="whatsapp-select-all-btn"
            onClick={toggleSelectAll}
            type="button"
          >
            {isAllSelected ? (
              <CheckSquare size={18} className="whatsapp-checkbox checked" />
            ) : isSomeSelected ? (
              <CheckSquare size={18} className="whatsapp-checkbox partial" />
            ) : (
              <Square size={18} className="whatsapp-checkbox" />
            )}
            <span>{t('admin.whatsapp.selectAll')}</span>
          </button>
          {selectedIds.size > 0 && (
            <>
              <span className="whatsapp-selected-count">
                {t('admin.whatsapp.selectedCount', { count: selectedIds.size })}
              </span>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setShowBulkDeleteConfirm(true)}
              >
                <Trash2 size={14} />
                {t('admin.whatsapp.deleteSelected')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Messages List */}
      <div className="audit-logs-container animate-fade-in-up stagger-3">
        {loading ? (
          <div className="audit-loading">
            <RefreshCw size={24} className="spin" />
            <span>{t('admin.whatsapp.loadingMessages')}</span>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="audit-empty">
            <MessageCircle size={48} strokeWidth={1} />
            <h3>{t('admin.whatsapp.noMessagesFound')}</h3>
            <p>{t('admin.whatsapp.noMessagesDesc')}</p>
          </div>
        ) : (
          <>
            <div className="audit-logs-list">
              {filteredMessages.map((msg) => (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  isExpanded={expandedIds.has(msg.id)}
                  isSelected={selectedIds.has(msg.id)}
                  onToggle={() => toggleExpand(msg.id)}
                  onSelect={toggleSelect}
                  onDelete={setDeleteTarget}
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

      {/* Single Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('admin.whatsapp.deleteMessageTitle')}
        message={t('admin.whatsapp.deleteMessageConfirm')}
        confirmText={t('common.delete')}
        confirmVariant="danger"
        loading={deleting}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title={t('admin.whatsapp.deleteSelectedTitle')}
        message={t('admin.whatsapp.deleteSelectedConfirm', { count: selectedIds.size })}
        confirmText={t('common.delete')}
        confirmVariant="danger"
        loading={bulkDeleting}
      />
    </div>
  );
}
