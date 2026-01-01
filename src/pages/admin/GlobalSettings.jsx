import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  Calendar,
  DollarSign,
  ToggleLeft,
  Loader2,
  Save,
  RefreshCw,
} from 'lucide-react';
import { adminService } from '../../services';
import { useApp } from '../../context/AppContext';
import './AdminPages.css';
import './GlobalSettings.css';

// Reusable section component
function SettingsSection({ icon: Icon, title, description, children }) {
  return (
    <div className="admin-settings-section">
      <div className="admin-settings-section-header">
        <div className="admin-settings-section-icon">
          <Icon size={22} strokeWidth={1.5} />
        </div>
        <div className="admin-settings-section-info">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="admin-settings-section-content">{children}</div>
    </div>
  );
}

// Reusable settings item component
function SettingsItem({ label, description, children }) {
  return (
    <div className="admin-settings-item">
      <div className="admin-settings-item-info">
        <span className="admin-settings-item-label">{label}</span>
        {description && <span className="admin-settings-item-desc">{description}</span>}
      </div>
      <div className="admin-settings-item-control">{children}</div>
    </div>
  );
}

// Toggle component
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      className={`admin-toggle ${checked ? 'active' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
    >
      <span className="admin-toggle-thumb" />
    </button>
  );
}

// Time options for select
const generateTimeOptions = () => {
  const times = [];
  for (let h = 6; h <= 23; h++) {
    times.push(`${h.toString().padStart(2, '0')}:00`);
    if (h < 23) {
      times.push(`${h.toString().padStart(2, '0')}:30`);
    }
  }
  return times;
};

const TIME_OPTIONS = generateTimeOptions();

const BUFFER_OPTIONS = [0, 5, 10, 15, 30];
const SLOT_DURATION_OPTIONS = [15, 30, 45, 60];
const CURRENCY_OPTIONS = [
  { code: 'KWD', label: 'KWD - Kuwaiti Dinar' },
  { code: 'SAR', label: 'SAR - Saudi Riyal' },
  { code: 'AED', label: 'AED - UAE Dirham' },
  { code: 'BHD', label: 'BHD - Bahraini Dinar' },
  { code: 'OMR', label: 'OMR - Omani Rial' },
  { code: 'QAR', label: 'QAR - Qatari Riyal' },
];

export default function GlobalSettings() {
  const { t } = useTranslation();
  const { showToast } = useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [settings, setSettings] = useState({});

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await adminService.getSettings();
      // Convert to flat key-value object
      const flatSettings = {};
      Object.entries(data).forEach(([key, obj]) => {
        flatSettings[key] = obj.value;
      });
      setSettings(flatSettings);
    } catch (error) {
      console.error('Error loading settings:', error);
      showToast?.(t('admin.globalSettings.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSettingChange = async (key, value) => {
    const previousValue = settings[key];

    // Optimistic update
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaving(prev => ({ ...prev, [key]: true }));

    try {
      await adminService.updateSetting(key, value);
      showToast?.(t('admin.globalSettings.saved'), 'success');
    } catch (error) {
      console.error('Error saving setting:', error);
      // Revert on error
      setSettings(prev => ({ ...prev, [key]: previousValue }));
      showToast?.(t('admin.globalSettings.saveError'), 'error');
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
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
            <h1>{t('admin.globalSettings.title')}</h1>
            <p>{t('admin.globalSettings.subtitle')}</p>
          </div>
          <button className="admin-refresh-btn" onClick={loadSettings} title={t('common.refresh')}>
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="admin-settings-grid">
        {/* Business Defaults Section */}
        <SettingsSection
          icon={Clock}
          title={t('admin.globalSettings.businessDefaults.title')}
          description={t('admin.globalSettings.businessDefaults.description')}
        >
          <SettingsItem
            label={t('admin.globalSettings.businessDefaults.openingTime')}
            description={t('admin.globalSettings.businessDefaults.openingTimeDesc')}
          >
            <select
              value={settings.default_opening_time || '09:00'}
              onChange={(e) => handleSettingChange('default_opening_time', e.target.value)}
              className="admin-settings-select"
              disabled={saving.default_opening_time}
            >
              {TIME_OPTIONS.map(time => (
                <option key={time} value={time}>{time}</option>
              ))}
            </select>
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.businessDefaults.closingTime')}
            description={t('admin.globalSettings.businessDefaults.closingTimeDesc')}
          >
            <select
              value={settings.default_closing_time || '21:00'}
              onChange={(e) => handleSettingChange('default_closing_time', e.target.value)}
              className="admin-settings-select"
              disabled={saving.default_closing_time}
            >
              {TIME_OPTIONS.map(time => (
                <option key={time} value={time}>{time}</option>
              ))}
            </select>
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.businessDefaults.bookingLeadTime')}
            description={t('admin.globalSettings.businessDefaults.bookingLeadTimeDesc')}
          >
            <div className="admin-number-input-wrapper">
              <input
                type="number"
                min="0"
                max="168"
                value={settings.booking_lead_time_hours ?? 2}
                onChange={(e) => handleSettingChange('booking_lead_time_hours', parseInt(e.target.value) || 0)}
                className="admin-number-input"
                disabled={saving.booking_lead_time_hours}
              />
              <span className="admin-input-suffix">{t('common.hours')}</span>
            </div>
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.businessDefaults.cancellationPolicy')}
            description={t('admin.globalSettings.businessDefaults.cancellationPolicyDesc')}
          >
            <div className="admin-number-input-wrapper">
              <input
                type="number"
                min="0"
                max="72"
                value={settings.cancellation_policy_hours ?? 24}
                onChange={(e) => handleSettingChange('cancellation_policy_hours', parseInt(e.target.value) || 0)}
                className="admin-number-input"
                disabled={saving.cancellation_policy_hours}
              />
              <span className="admin-input-suffix">{t('common.hours')}</span>
            </div>
          </SettingsItem>
        </SettingsSection>

        {/* Booking Rules Section */}
        <SettingsSection
          icon={Calendar}
          title={t('admin.globalSettings.bookingRules.title')}
          description={t('admin.globalSettings.bookingRules.description')}
        >
          <SettingsItem
            label={t('admin.globalSettings.bookingRules.maxPerSlot')}
            description={t('admin.globalSettings.bookingRules.maxPerSlotDesc')}
          >
            <div className="admin-number-input-wrapper">
              <input
                type="number"
                min="1"
                max="10"
                value={settings.max_bookings_per_slot ?? 1}
                onChange={(e) => handleSettingChange('max_bookings_per_slot', parseInt(e.target.value) || 1)}
                className="admin-number-input"
                disabled={saving.max_bookings_per_slot}
              />
            </div>
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.bookingRules.autoConfirm')}
            description={t('admin.globalSettings.bookingRules.autoConfirmDesc')}
          >
            <Toggle
              checked={settings.auto_confirm_bookings === true}
              onChange={(val) => handleSettingChange('auto_confirm_bookings', val)}
              disabled={saving.auto_confirm_bookings}
            />
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.bookingRules.bufferTime')}
            description={t('admin.globalSettings.bookingRules.bufferTimeDesc')}
          >
            <select
              value={settings.buffer_time_minutes ?? 0}
              onChange={(e) => handleSettingChange('buffer_time_minutes', parseInt(e.target.value))}
              className="admin-settings-select"
              disabled={saving.buffer_time_minutes}
            >
              {BUFFER_OPTIONS.map(mins => (
                <option key={mins} value={mins}>
                  {mins === 0 ? t('common.none') : `${mins} ${t('common.minutes')}`}
                </option>
              ))}
            </select>
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.bookingRules.slotDuration')}
            description={t('admin.globalSettings.bookingRules.slotDurationDesc')}
          >
            <select
              value={settings.slot_duration_minutes ?? 30}
              onChange={(e) => handleSettingChange('slot_duration_minutes', parseInt(e.target.value))}
              className="admin-settings-select"
              disabled={saving.slot_duration_minutes}
            >
              {SLOT_DURATION_OPTIONS.map(mins => (
                <option key={mins} value={mins}>{mins} {t('common.minutes')}</option>
              ))}
            </select>
          </SettingsItem>
        </SettingsSection>

        {/* Financial Settings Section */}
        <SettingsSection
          icon={DollarSign}
          title={t('admin.globalSettings.financial.title')}
          description={t('admin.globalSettings.financial.description')}
        >
          <SettingsItem
            label={t('admin.globalSettings.financial.currency')}
            description={t('admin.globalSettings.financial.currencyDesc')}
          >
            <select
              value={settings.default_currency || 'KWD'}
              onChange={(e) => handleSettingChange('default_currency', e.target.value)}
              className="admin-settings-select"
              disabled={saving.default_currency}
            >
              {CURRENCY_OPTIONS.map(curr => (
                <option key={curr.code} value={curr.code}>{curr.label}</option>
              ))}
            </select>
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.financial.taxRate')}
            description={t('admin.globalSettings.financial.taxRateDesc')}
          >
            <div className="admin-number-input-wrapper">
              <input
                type="number"
                min="0"
                max="25"
                step="0.5"
                value={settings.tax_rate_percent ?? 0}
                onChange={(e) => handleSettingChange('tax_rate_percent', parseFloat(e.target.value) || 0)}
                className="admin-number-input"
                disabled={saving.tax_rate_percent}
              />
              <span className="admin-input-suffix">%</span>
            </div>
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.financial.commission')}
            description={t('admin.globalSettings.financial.commissionDesc')}
          >
            <div className="admin-number-input-wrapper">
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={settings.commission_percent ?? 0}
                onChange={(e) => handleSettingChange('commission_percent', parseFloat(e.target.value) || 0)}
                className="admin-number-input"
                disabled={saving.commission_percent}
              />
              <span className="admin-input-suffix">%</span>
            </div>
          </SettingsItem>
        </SettingsSection>

        {/* Feature Toggles Section */}
        <SettingsSection
          icon={ToggleLeft}
          title={t('admin.globalSettings.features.title')}
          description={t('admin.globalSettings.features.description')}
        >
          <SettingsItem
            label={t('admin.globalSettings.features.walkIns')}
            description={t('admin.globalSettings.features.walkInsDesc')}
          >
            <Toggle
              checked={settings.enable_walk_ins === true}
              onChange={(val) => handleSettingChange('enable_walk_ins', val)}
              disabled={saving.enable_walk_ins}
            />
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.features.onlinePayments')}
            description={t('admin.globalSettings.features.onlinePaymentsDesc')}
          >
            <Toggle
              checked={settings.enable_online_payments === true}
              onChange={(val) => handleSettingChange('enable_online_payments', val)}
              disabled={saving.enable_online_payments}
            />
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.features.waitlist')}
            description={t('admin.globalSettings.features.waitlistDesc')}
          >
            <Toggle
              checked={settings.enable_waitlist === true}
              onChange={(val) => handleSettingChange('enable_waitlist', val)}
              disabled={saving.enable_waitlist}
            />
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.features.reviews')}
            description={t('admin.globalSettings.features.reviewsDesc')}
          >
            <Toggle
              checked={settings.enable_reviews === true}
              onChange={(val) => handleSettingChange('enable_reviews', val)}
              disabled={saving.enable_reviews}
            />
          </SettingsItem>

          <SettingsItem
            label={t('admin.globalSettings.features.smsNotifications')}
            description={t('admin.globalSettings.features.smsNotificationsDesc')}
          >
            <Toggle
              checked={settings.enable_sms_notifications === true}
              onChange={(val) => handleSettingChange('enable_sms_notifications', val)}
              disabled={saving.enable_sms_notifications}
            />
          </SettingsItem>
        </SettingsSection>
      </div>
    </div>
  );
}
