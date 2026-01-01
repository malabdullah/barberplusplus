import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  Search,
  Edit2,
  Loader2,
  RefreshCw,
  Check,
  X,
  Eye,
} from 'lucide-react';
import Modal from '../../components/UI/Modal';
import { adminService } from '../../services';
import { useApp } from '../../context/AppContext';
import './AdminPages.css';
import './NotificationTemplates.css';

// Template type icons and labels
const TEMPLATE_TYPES = {
  booking_created: { label: 'New Booking', labelAr: 'حجز جديد', color: '#22c55e' },
  booking_cancelled: { label: 'Cancellation', labelAr: 'إلغاء', color: '#ef4444' },
  booking_status_changed: { label: 'Status Change', labelAr: 'تغيير الحالة', color: '#f59e0b' },
  booking_reminder: { label: 'Reminder', labelAr: 'تذكير', color: '#3b82f6' },
  barber_profile_updated: { label: 'Profile Update', labelAr: 'تحديث الملف', color: '#8b5cf6' },
  barber_availability_updated: { label: 'Availability', labelAr: 'التوفر', color: '#06b6d4' },
};

// Available template variables
const TEMPLATE_VARIABLES = [
  { key: 'customerName', labelEn: 'Customer Name', labelAr: 'اسم العميل' },
  { key: 'barberName', labelEn: 'Barber Name', labelAr: 'اسم الحلاق' },
  { key: 'serviceName', labelEn: 'Service Name', labelAr: 'اسم الخدمة' },
  { key: 'date', labelEn: 'Date', labelAr: 'التاريخ' },
  { key: 'time', labelEn: 'Time', labelAr: 'الوقت' },
  { key: 'branchName', labelEn: 'Branch Name', labelAr: 'اسم الفرع' },
  { key: 'status', labelEn: 'Status', labelAr: 'الحالة' },
];

// Sample data for preview
const SAMPLE_DATA = {
  customerName: 'Ahmed',
  barberName: 'Mohammed',
  serviceName: 'Haircut',
  date: '2025-01-15',
  time: '10:30 AM',
  branchName: 'Main Branch',
  status: 'Confirmed',
};

export default function NotificationTemplates() {
  const { t, i18n } = useTranslation();
  const { showToast } = useApp();
  const isRTL = i18n.language === 'ar';

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [activeTab, setActiveTab] = useState('en');
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Form state
  const [form, setForm] = useState({
    titleEn: '',
    titleAr: '',
    messageEn: '',
    messageAr: '',
    isActive: true,
  });

  // Refs for cursor position
  const messageEnRef = useRef(null);
  const messageArRef = useRef(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await adminService.getNotificationTemplates();
      setTemplates(data);
    } catch (error) {
      console.error('Error loading templates:', error);
      showToast?.(t('admin.notificationTemplates.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredTemplates = templates.filter((template) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      template.templateKey.toLowerCase().includes(query) ||
      template.titleEn?.toLowerCase().includes(query) ||
      template.titleAr?.includes(query)
    );
  });

  const openEditModal = (template) => {
    setEditingTemplate(template);
    setForm({
      titleEn: template.titleEn || '',
      titleAr: template.titleAr || '',
      messageEn: template.messageEn || '',
      messageAr: template.messageAr || '',
      isActive: template.isActive ?? true,
    });
    setActiveTab('en');
    setShowPreview(false);
    setEditModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.titleEn.trim() || !form.messageEn.trim()) {
      showToast?.(t('admin.notificationTemplates.requiredFields'), 'error');
      return;
    }

    setSaving(true);
    try {
      await adminService.updateNotificationTemplate(editingTemplate.id, form);
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === editingTemplate.id ? { ...t, ...form } : t
        )
      );
      showToast?.(t('admin.notificationTemplates.saved'), 'success');
      setEditModalOpen(false);
    } catch (error) {
      console.error('Error saving template:', error);
      showToast?.(t('admin.notificationTemplates.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (template) => {
    const newValue = !template.isActive;
    try {
      await adminService.updateNotificationTemplate(template.id, {
        ...template,
        isActive: newValue,
      });
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === template.id ? { ...t, isActive: newValue } : t
        )
      );
      showToast?.(
        newValue
          ? t('admin.notificationTemplates.activated')
          : t('admin.notificationTemplates.deactivated'),
        'success'
      );
    } catch (error) {
      console.error('Error toggling template:', error);
      showToast?.(t('admin.notificationTemplates.saveError'), 'error');
    }
  };

  const insertVariable = (variableKey) => {
    const variableText = `{{${variableKey}}}`;
    const ref = activeTab === 'en' ? messageEnRef : messageArRef;
    const field = activeTab === 'en' ? 'messageEn' : 'messageAr';

    if (ref.current) {
      const start = ref.current.selectionStart;
      const end = ref.current.selectionEnd;
      const currentValue = form[field];
      const newValue =
        currentValue.substring(0, start) +
        variableText +
        currentValue.substring(end);

      setForm({ ...form, [field]: newValue });

      // Set cursor position after inserted variable
      setTimeout(() => {
        ref.current.focus();
        ref.current.setSelectionRange(
          start + variableText.length,
          start + variableText.length
        );
      }, 0);
    }
  };

  const renderPreview = (message) => {
    if (!message) return '';
    let preview = message;
    TEMPLATE_VARIABLES.forEach((v) => {
      const regex = new RegExp(`{{${v.key}}}`, 'g');
      preview = preview.replace(
        regex,
        `<span class="preview-variable">${SAMPLE_DATA[v.key]}</span>`
      );
    });
    return preview;
  };

  const getTemplateType = (key) => {
    return TEMPLATE_TYPES[key] || { label: key, labelAr: key, color: '#6366f1' };
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-loading">
          <Loader2 size={32} className="spinning" />
          <span>{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <Link to="/admin/configuration" className="admin-back-link">
        <ArrowLeft size={16} />
        {t('admin.config.title')}
      </Link>

      <div className="admin-page-header">
        <div className="admin-page-header-row">
          <div>
            <h1>{t('admin.notificationTemplates.title')}</h1>
            <p>{t('admin.notificationTemplates.subtitle')}</p>
          </div>
          <button
            className="admin-refresh-btn"
            onClick={loadTemplates}
            title={t('common.refresh')}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="admin-toolbar">
        <div className="admin-search-wrapper">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('admin.notificationTemplates.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <span className="admin-count">
          {filteredTemplates.length} {t('admin.notificationTemplates.templates')}
        </span>
      </div>

      {/* Templates Grid */}
      <div className="templates-grid">
        {filteredTemplates.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty-icon">
              <Bell size={32} />
            </div>
            <h3>{t('admin.notificationTemplates.noTemplates')}</h3>
          </div>
        ) : (
          filteredTemplates.map((template) => {
            const type = getTemplateType(template.templateKey);
            return (
              <div key={template.id} className="template-card">
                <div className="template-header">
                  <div
                    className="template-type-badge"
                    style={{ backgroundColor: `${type.color}20`, color: type.color }}
                  >
                    {isRTL ? type.labelAr : type.label}
                  </div>
                  <button
                    className={`template-active-toggle ${template.isActive ? 'active' : ''}`}
                    onClick={() => handleToggleActive(template)}
                    title={template.isActive ? t('admin.notificationTemplates.active') : t('admin.notificationTemplates.inactive')}
                  >
                    {template.isActive ? <Check size={14} /> : <X size={14} />}
                  </button>
                </div>
                <div className="template-content">
                  <h3>{isRTL ? (template.titleAr || template.titleEn) : template.titleEn}</h3>
                  <p className="template-key">{template.templateKey}</p>
                  <p className="template-preview">
                    {isRTL
                      ? (template.messageAr || template.messageEn)?.substring(0, 80)
                      : template.messageEn?.substring(0, 80)}
                    {((isRTL ? template.messageAr : template.messageEn)?.length || 0) > 80 && '...'}
                  </p>
                </div>
                <div className="template-footer">
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => openEditModal(template)}
                  >
                    <Edit2 size={14} />
                    {t('common.edit')}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Edit Modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={t('admin.notificationTemplates.editTemplate')}
        size="large"
      >
        <div className="template-editor">
          {/* Language Tabs */}
          <div className="template-tabs">
            <button
              className={`template-tab ${activeTab === 'en' ? 'active' : ''}`}
              onClick={() => setActiveTab('en')}
            >
              English
            </button>
            <button
              className={`template-tab ${activeTab === 'ar' ? 'active' : ''}`}
              onClick={() => setActiveTab('ar')}
            >
              العربية
            </button>
            <button
              className={`template-tab preview-tab ${showPreview ? 'active' : ''}`}
              onClick={() => setShowPreview(!showPreview)}
            >
              <Eye size={14} />
              {t('admin.notificationTemplates.preview')}
            </button>
          </div>

          {/* Form Content */}
          <div className="template-form">
            {activeTab === 'en' && !showPreview && (
              <>
                <div className="form-group">
                  <label className="form-label">
                    {t('admin.notificationTemplates.titleEn')} *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.titleEn}
                    onChange={(e) => setForm({ ...form, titleEn: e.target.value })}
                    placeholder="e.g., Booking Confirmed"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">
                    {t('admin.notificationTemplates.messageEn')} *
                  </label>
                  <textarea
                    ref={messageEnRef}
                    className="form-input template-textarea"
                    value={form.messageEn}
                    onChange={(e) => setForm({ ...form, messageEn: e.target.value })}
                    placeholder="Your appointment with {{barberName}} is confirmed for {{date}} at {{time}}."
                    rows={5}
                  />
                </div>
              </>
            )}

            {activeTab === 'ar' && !showPreview && (
              <>
                <div className="form-group">
                  <label className="form-label">
                    {t('admin.notificationTemplates.titleAr')}
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.titleAr}
                    onChange={(e) => setForm({ ...form, titleAr: e.target.value })}
                    placeholder="مثال: تم تأكيد الحجز"
                    dir="rtl"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">
                    {t('admin.notificationTemplates.messageAr')}
                  </label>
                  <textarea
                    ref={messageArRef}
                    className="form-input template-textarea"
                    value={form.messageAr}
                    onChange={(e) => setForm({ ...form, messageAr: e.target.value })}
                    placeholder="تم تأكيد موعدك مع {{barberName}} في {{date}} الساعة {{time}}."
                    rows={5}
                    dir="rtl"
                  />
                </div>
              </>
            )}

            {showPreview && (
              <div className="template-preview-panel">
                <div className="preview-section">
                  <h4>English</h4>
                  <div className="preview-card">
                    <div className="preview-title">{form.titleEn || 'No title'}</div>
                    <div
                      className="preview-message"
                      dangerouslySetInnerHTML={{
                        __html: renderPreview(form.messageEn) || 'No message',
                      }}
                    />
                  </div>
                </div>
                <div className="preview-section" dir="rtl">
                  <h4>العربية</h4>
                  <div className="preview-card">
                    <div className="preview-title">{form.titleAr || 'بدون عنوان'}</div>
                    <div
                      className="preview-message"
                      dangerouslySetInnerHTML={{
                        __html: renderPreview(form.messageAr) || 'بدون رسالة',
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Variables */}
            {!showPreview && (
              <div className="template-variables">
                <label className="form-label">
                  {t('admin.notificationTemplates.variables')}
                </label>
                <div className="variable-pills">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      className="variable-pill"
                      onClick={() => insertVariable(v.key)}
                      title={t('admin.notificationTemplates.insertVariable')}
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Modal Actions */}
          <div className="modal-actions">
            <label className="template-active-label">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              {t('admin.notificationTemplates.active')}
            </label>
            <div className="modal-actions-right">
              <button
                className="btn btn-secondary"
                onClick={() => setEditModalOpen(false)}
                disabled={saving}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving && <Loader2 size={16} className="spinning" />}
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
