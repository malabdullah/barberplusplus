import React, { useState, useEffect, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  MessagesSquare,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  ArrowLeft,
  X,
  Phone,
  User,
  Globe,
  MessageCircle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { adminService } from '../../services/admin.service';
import Modal from '../../components/UI/Modal';
import './AdminPages.css';
import './AuditPages.css';
import './WhatsAppPages.css';

// State badge component
const StateBadge = memo(function StateBadge({ state, t }) {
  const colorMap = {
    greeting: 'info',
    booking_flow: 'warning',
    completed: 'success',
    cancelled: 'error',
  };
  const color = colorMap[state] || 'secondary';
  return (
    <span className={`audit-action-badge ${color}`}>
      {t(`admin.whatsapp.states.${state}`, { defaultValue: state })}
    </span>
  );
});

// Language badge component
const LanguageBadge = memo(function LanguageBadge({ language }) {
  return (
    <span className="whatsapp-lang-badge">
      <Globe size={12} />
      {language?.toUpperCase() || 'EN'}
    </span>
  );
});

// Conversation row component
const ConversationRow = memo(function ConversationRow({ conversation, onViewMessages, t, dateLocale }) {
  return (
    <div className="audit-log-row">
      <div className="audit-log-row-main" onClick={() => onViewMessages(conversation)}>
        <div className="whatsapp-conv-phone">
          <Phone size={16} />
          <span>+{conversation.phoneCountryCode} {conversation.phoneNumber}</span>
        </div>
        <div className="whatsapp-conv-customer">
          <User size={14} />
          <span>{conversation.customerName || t('admin.whatsapp.unknownCustomer')}</span>
        </div>
        <StateBadge state={conversation.currentState} t={t} />
        <LanguageBadge language={conversation.language} />
        <span className="audit-log-time">
          {conversation.lastMessageAt
            ? format(parseISO(conversation.lastMessageAt), 'MMM d, HH:mm', { locale: dateLocale })
            : '—'}
        </span>
        <ChevronRight size={18} className="whatsapp-row-arrow" />
      </div>
    </div>
  );
});

// Message thread modal content
const MessageThread = memo(function MessageThread({ conversation, messages, t, dateLocale }) {
  return (
    <div className="whatsapp-thread">
      {/* Conversation Info */}
      <div className="whatsapp-thread-header">
        <div className="whatsapp-thread-contact">
          <Phone size={18} />
          <span>+{conversation.phoneCountryCode} {conversation.phoneNumber}</span>
        </div>
        {conversation.customerName && (
          <div className="whatsapp-thread-name">
            <User size={16} />
            <span>{conversation.customerName}</span>
          </div>
        )}
        <div className="whatsapp-thread-meta">
          <StateBadge state={conversation.currentState} t={t} />
          <LanguageBadge language={conversation.language} />
        </div>
      </div>

      {/* Messages */}
      <div className="whatsapp-messages-list">
        {messages.length === 0 ? (
          <div className="whatsapp-empty-thread">
            <MessageCircle size={32} strokeWidth={1} />
            <p>{t('admin.whatsapp.noMessages')}</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`whatsapp-message ${msg.direction}`}
            >
              <div className="whatsapp-message-content">
                {msg.content}
              </div>
              <div className="whatsapp-message-meta">
                <span className="whatsapp-message-time">
                  {format(parseISO(msg.createdAt), 'MMM d, HH:mm:ss', { locale: dateLocale })}
                </span>
                {msg.status && (
                  <span className={`whatsapp-message-status ${msg.status}`}>
                    {t(`admin.whatsapp.status.${msg.status}`, { defaultValue: msg.status })}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Context (collapsible) */}
      {conversation.context && Object.keys(conversation.context).length > 0 && (
        <details className="whatsapp-context-section">
          <summary>{t('admin.whatsapp.conversationContext')}</summary>
          <pre className="whatsapp-context-json">
            {JSON.stringify(conversation.context, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
});

export default function WhatsAppConversations() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;

  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [states, setStates] = useState([]);

  // Filters
  const [filters, setFilters] = useState({
    search: '',
    state: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const ITEMS_PER_PAGE = 25;

  // Modal
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Load conversations
  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminService.getWhatsAppConversations({
        page,
        limit: ITEMS_PER_PAGE,
        search: filters.search || '',
        state: filters.state || null,
      });

      setConversations(result.conversations);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  // Load filter options
  const loadFilterOptions = useCallback(async () => {
    try {
      const statesResult = await adminService.getWhatsAppConversationStates();
      setStates(statesResult);
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  // View conversation messages
  const handleViewMessages = async (conversation) => {
    setSelectedConversation(conversation);
    setLoadingMessages(true);
    try {
      const result = await adminService.getConversationDetails(conversation.id);
      setConversationMessages(result.messages);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  };

  // Handle filter changes
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  // Clear filters
  const clearFilters = () => {
    setFilters({ search: '', state: '' });
    setPage(1);
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
          <h1 className="audit-page-title">{t('admin.whatsapp.conversations')}</h1>
          <p className="audit-page-description">{t('admin.whatsapp.conversationsSubtitle')}</p>
        </div>
        <div className="audit-page-actions">
          <button
            className="btn btn-secondary"
            onClick={loadConversations}
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
            placeholder={t('admin.whatsapp.searchConversations')}
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
            <label>{t('admin.whatsapp.filterState')}</label>
            <select
              value={filters.state}
              onChange={(e) => handleFilterChange('state', e.target.value)}
              className="form-input form-select"
            >
              <option value="">{t('admin.whatsapp.allStates')}</option>
              {states.map((state) => (
                <option key={state} value={state}>
                  {t(`admin.whatsapp.states.${state}`, { defaultValue: state })}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-text" onClick={clearFilters}>
            <X size={16} />
            {t('admin.audit.filters.clear')}
          </button>
        </div>
      )}

      {/* Conversations List */}
      <div className="audit-logs-container animate-fade-in-up stagger-2">
        {loading ? (
          <div className="audit-loading">
            <RefreshCw size={24} className="spin" />
            <span>{t('admin.whatsapp.loadingConversations')}</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="audit-empty">
            <MessagesSquare size={48} strokeWidth={1} />
            <h3>{t('admin.whatsapp.noConversations')}</h3>
            <p>{t('admin.whatsapp.noConversationsDesc')}</p>
          </div>
        ) : (
          <>
            <div className="audit-logs-list">
              {conversations.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conversation={conv}
                  onViewMessages={handleViewMessages}
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

      {/* Conversation Modal */}
      <Modal
        isOpen={!!selectedConversation}
        onClose={() => {
          setSelectedConversation(null);
          setConversationMessages([]);
        }}
        title={t('admin.whatsapp.conversationThread')}
        size="large"
      >
        {selectedConversation && (
          loadingMessages ? (
            <div className="audit-loading">
              <RefreshCw size={24} className="spin" />
              <span>{t('admin.whatsapp.loadingMessages')}</span>
            </div>
          ) : (
            <MessageThread
              conversation={selectedConversation}
              messages={conversationMessages}
              t={t}
              dateLocale={dateLocale}
            />
          )
        )}
      </Modal>
    </div>
  );
}
