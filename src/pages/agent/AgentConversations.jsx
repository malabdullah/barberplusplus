import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  MessageCircle,
  Search,
  Phone,
  User,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Send,
  Bot,
  UserCheck,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { useApp } from '../../context/AppContext';
import { agentService } from '../../services/agent.service';
import './AgentPages.css';

// Direction badge component
const DirectionBadge = ({ direction, t }) => {
  const isInbound = direction === 'inbound';
  return (
    <span className={`agent-direction-badge ${direction}`}>
      {isInbound ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
      {t(`admin.whatsapp.direction.${direction}`, { defaultValue: direction })}
    </span>
  );
};

// Conversation state badge component
const StateBadge = ({ state, t }) => {
  const stateConfig = {
    agent_takeover: { color: 'success', icon: UserCheck },
    greeting: { color: 'info', icon: Bot },
    booking_flow: { color: 'warning', icon: Bot },
    completed: { color: 'secondary', icon: Bot },
    cancelled: { color: 'error', icon: Bot },
  };

  const config = stateConfig[state] || stateConfig.greeting;
  const Icon = config.icon;

  return (
    <span className={`agent-state-badge ${config.color}`}>
      <Icon size={12} />
      {state === 'agent_takeover'
        ? t('agent.conversations.agentTakeover')
        : t(`admin.whatsapp.states.${state}`, { defaultValue: state })}
    </span>
  );
};

export default function AgentConversations() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useApp();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const messagesEndRef = useRef(null);

  // Realtime subscription refs
  const messagesChannelRef = useRef(null);
  const conversationChannelRef = useRef(null);

  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [conversationDetails, setConversationDetails] = useState(null);
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Message composition state
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const ITEMS_PER_PAGE = 20;

  // Auto-scroll to bottom when messages change
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Cleanup realtime subscriptions on unmount
  useEffect(() => {
    return () => {
      agentService.unsubscribe(messagesChannelRef.current);
      agentService.unsubscribe(conversationChannelRef.current);
    };
  }, []);

  // Load conversations
  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const result = await agentService.getConversations({
        page,
        limit: ITEMS_PER_PAGE,
        search: searchQuery || null,
      });
      setConversations(result.conversations || []);
      setTotalPages(Math.ceil((result.total || 0) / ITEMS_PER_PAGE));
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load messages and details for selected conversation
  const loadMessages = async (conversation) => {
    // Clean up previous subscriptions
    agentService.unsubscribe(messagesChannelRef.current);
    agentService.unsubscribe(conversationChannelRef.current);

    setSelectedConversation(conversation);
    setLoadingMessages(true);
    setMessageText('');
    setSendError(null);
    try {
      const [msgs, details] = await Promise.all([
        agentService.getConversationMessages(conversation.id),
        agentService.getConversationDetails(conversation.id),
      ]);
      setMessages(msgs);
      setConversationDetails(details);

      // Set up realtime subscription for new messages
      messagesChannelRef.current = agentService.subscribeToMessages(
        conversation.id,
        (newMessage) => {
          setMessages((prev) => {
            // Prevent duplicates
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
        }
      );

      // Set up realtime subscription for conversation state changes
      conversationChannelRef.current = agentService.subscribeToConversation(
        conversation.id,
        (updatedConversation) => {
          setConversationDetails(updatedConversation);
        }
      );
    } catch (error) {
      console.error('Error loading messages:', error);
      setMessages([]);
      setConversationDetails(null);
    } finally {
      setLoadingMessages(false);
    }
  };

  // Refresh messages for current conversation
  const refreshMessages = async () => {
    if (!selectedConversation) return;
    try {
      const [msgs, details] = await Promise.all([
        agentService.getConversationMessages(selectedConversation.id),
        agentService.getConversationDetails(selectedConversation.id),
      ]);
      setMessages(msgs);
      setConversationDetails(details);
    } catch (error) {
      console.error('Error refreshing messages:', error);
    }
  };

  // Handle send message
  const handleSendMessage = async () => {
    if (!messageText.trim() || sending || !selectedConversation || !conversationDetails) return;

    setSending(true);
    setSendError(null);

    try {
      await agentService.sendMessage(
        selectedConversation.id,
        conversationDetails.phoneNumber,
        conversationDetails.phoneCountryCode,
        messageText.trim(),
        user?.id
      );
      setMessageText('');
      // Refresh messages to show the sent message
      await refreshMessages();
    } catch (error) {
      console.error('Error sending message:', error);
      setSendError(error.message || t('agent.conversations.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  // Handle key down in textarea (Ctrl/Cmd + Enter to send)
  const handleTextareaKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Handle release to AI
  const handleReleaseToAI = async () => {
    if (!selectedConversation) return;
    try {
      await agentService.releaseConversation(selectedConversation.id);
      setConversationDetails(prev => prev ? { ...prev, currentState: 'greeting' } : null);
    } catch (error) {
      console.error('Error releasing conversation:', error);
    }
  };

  // Handle takeover conversation
  const handleTakeover = async () => {
    if (!selectedConversation) return;
    try {
      await agentService.takeoverConversation(selectedConversation.id);
      setConversationDetails(prev => prev ? { ...prev, currentState: 'agent_takeover' } : null);
    } catch (error) {
      console.error('Error taking over conversation:', error);
    }
  };

  // Handle create booking - navigate with customer data pre-filled
  const handleCreateBooking = () => {
    // Extract phone number without country code
    // Note: phoneCountryCode from DB already includes "+" (e.g., "+965")
    const phoneNumber = conversationDetails?.phoneNumber || '';
    const countryCode = conversationDetails?.phoneCountryCode || '';
    const countryCodeDigits = countryCode.replace('+', '');
    const customerPhone = phoneNumber.startsWith(countryCodeDigits)
      ? phoneNumber.slice(countryCodeDigits.length)
      : phoneNumber;

    navigate('/agent/bookings/new', {
      state: {
        customer: {
          customerName: conversationDetails?.customerName || '',
          customerPhone: customerPhone,
          customerCountryCode: countryCode,  // Already has "+" from DB
        },
        fromConversation: conversationDetails?.id,
      },
    });
  };

  // Handle search
  const handleSearch = () => {
    setPage(1);
    loadConversations();
  };

  // Handle search on enter
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const isAgentTakeover = conversationDetails?.currentState === 'agent_takeover';

  return (
    <div className="agent-conversations">
      {/* Page Header */}
      <div className="agent-page-header">
        <div className="agent-page-header-content">
          <h1 className="agent-page-title">{t('agent.conversations.title')}</h1>
          <p className="agent-page-description">{t('agent.conversations.subtitle')}</p>
        </div>
        <div className="agent-page-actions">
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

      {/* Search */}
      <div className="agent-toolbar">
        <div className="agent-search">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('admin.whatsapp.searchConversations')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="agent-search-input"
          />
        </div>
      </div>

      <div className="agent-conversations-layout">
        {/* Conversations List */}
        <div className="agent-conversations-list">
          {loading ? (
            <div className="agent-loading">
              <RefreshCw size={24} className="spin" />
              <span>{t('admin.whatsapp.loadingConversations')}</span>
            </div>
          ) : conversations.length === 0 ? (
            <div className="agent-empty-state small">
              <MessageCircle size={32} />
              <p>{t('admin.whatsapp.noConversations')}</p>
            </div>
          ) : (
            <>
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`agent-conversation-card ${selectedConversation?.id === conv.id ? 'selected' : ''} ${conv.currentState === 'agent_takeover' ? 'takeover' : ''}`}
                  onClick={() => loadMessages(conv)}
                >
                  <div className="agent-conversation-avatar">
                    <Phone size={16} />
                  </div>
                  <div className="agent-conversation-info">
                    <div className="agent-conversation-top">
                      <span className="agent-conversation-phone">{conv.phoneNumber}</span>
                      {conv.currentState === 'agent_takeover' && (
                        <span className="agent-takeover-dot" title={t('agent.conversations.agentTakeover')} />
                      )}
                    </div>
                    <span className="agent-conversation-name">
                      {conv.customerName || t('admin.whatsapp.unknownCustomer')}
                    </span>
                  </div>
                  <span className="agent-conversation-time">
                    {conv.lastMessageAt
                      ? format(parseISO(conv.lastMessageAt), 'MMM d, HH:mm', { locale: dateLocale })
                      : '—'}
                  </span>
                </div>
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="agent-pagination">
                  <button
                    className="agent-pagination-btn"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="agent-pagination-info">
                    {page} / {totalPages}
                  </span>
                  <button
                    className="agent-pagination-btn"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Conversation Messages */}
        <div className="agent-conversation-detail">
          {selectedConversation ? (
            <>
              <div className="agent-conversation-header">
                <div className="agent-conversation-header-info">
                  <div className="agent-conversation-header-top">
                    <h2>
                      <Phone size={18} />
                      {conversationDetails?.phoneCountryCode && `${conversationDetails.phoneCountryCode} `}
                      {conversationDetails?.phoneNumber || selectedConversation.phoneNumber}
                    </h2>
                    {conversationDetails && (
                      <StateBadge state={conversationDetails.currentState} t={t} />
                    )}
                  </div>
                  <p>
                    <User size={14} />
                    {conversationDetails?.customerName || selectedConversation.customerName || t('admin.whatsapp.unknownCustomer')}
                  </p>
                </div>
                <div className="agent-conversation-header-actions">
                  {isAgentTakeover ? (
                    <button
                      className="btn btn-secondary"
                      onClick={handleReleaseToAI}
                      title={t('agent.conversations.releaseToAIDesc')}
                    >
                      <Bot size={16} />
                      {t('agent.conversations.releaseToAI')}
                    </button>
                  ) : (
                    <button
                      className="btn btn-secondary"
                      onClick={handleTakeover}
                      title={t('agent.conversations.takeoverDesc')}
                    >
                      <UserCheck size={16} />
                      {t('agent.conversations.takeover')}
                    </button>
                  )}
                  <button onClick={handleCreateBooking} className="btn btn-primary">
                    <Plus size={16} />
                    {t('agent.conversations.createBooking')}
                  </button>
                </div>
              </div>

              <div className="agent-messages-container">
                {loadingMessages ? (
                  <div className="agent-loading">
                    <RefreshCw size={20} className="spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="agent-empty-state small">
                    <MessageCircle size={24} />
                    <p>{t('admin.whatsapp.noMessages')}</p>
                  </div>
                ) : (
                  <div className="agent-messages-list">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`agent-message ${msg.direction} ${msg.metadata?.sent_by === 'agent' ? 'agent-sent' : ''}`}
                      >
                        <div className="agent-message-content">
                          {msg.content || '—'}
                        </div>
                        <div className="agent-message-meta">
                          <DirectionBadge direction={msg.direction} t={t} />
                          {msg.metadata?.sent_by === 'agent' && (
                            <span className="agent-message-sender">
                              <UserCheck size={10} />
                              {t('agent.conversations.sentByAgent')}
                            </span>
                          )}
                          <span className="agent-message-time">
                            {format(parseISO(msg.createdAt), 'MMM d, HH:mm:ss', { locale: dateLocale })}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Message Composer */}
              <div className="agent-message-composer">
                {sendError && (
                  <div className="agent-send-error">
                    {sendError}
                  </div>
                )}
                <div className="agent-composer-input-wrapper">
                  <textarea
                    className="agent-message-input"
                    placeholder={t('agent.conversations.typeMessage')}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleTextareaKeyDown}
                    disabled={sending}
                    rows={1}
                  />
                  <button
                    className="agent-send-btn"
                    onClick={handleSendMessage}
                    disabled={!messageText.trim() || sending}
                    title={t('agent.conversations.sendMessage')}
                  >
                    {sending ? (
                      <RefreshCw size={18} className="spin" />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </div>
                <p className="agent-composer-hint">
                  {t('agent.conversations.composerHint')}
                </p>
              </div>
            </>
          ) : (
            <div className="agent-empty-state">
              <MessageCircle size={48} />
              <h3>{t('agent.conversations.selectConversation')}</h3>
              <p>{t('agent.conversations.selectConversationDesc')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
