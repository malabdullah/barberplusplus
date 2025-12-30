import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User,
  Bell,
  Lock,
  Globe,
  Palette,
  HelpCircle,
  ChevronRight,
  Camera,
  Save,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
import SignOutCard from '../components/UI/SignOutCard';
import { useApp } from '../context/AppContext';
import { GCC_COUNTRIES } from '../constants/countries';
import { notificationPreferencesService } from '../services';
import './Settings.css';

function SettingsSection({ icon: Icon, title, description, children }) {
  return (
    <div className="settings-section animate-fade-in-up">
      <div className="settings-section-header">
        <div className="settings-section-icon">
          <Icon size={20} strokeWidth={1.5} />
        </div>
        <div className="settings-section-info">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="settings-section-content">{children}</div>
    </div>
  );
}

function SettingsItem({ label, description, children }) {
  return (
    <div className="settings-item">
      <div className="settings-item-info">
        <span className="settings-item-label">{label}</span>
        {description && <span className="settings-item-desc">{description}</span>}
      </div>
      <div className="settings-item-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      className={`toggle ${checked ? 'active' : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

// Parse phone to extract country code and number
const parsePhone = (fullPhone) => {
  if (!fullPhone) return { countryCode: '+965', phone: '' };

  // Try to match known country codes (check longer codes first)
  const sortedCountries = [...GCC_COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  for (const country of sortedCountries) {
    if (fullPhone.startsWith(country.code)) {
      return {
        countryCode: country.code,
        phone: fullPhone.slice(country.code.length).trim()
      };
    }
  }
  return { countryCode: '+965', phone: fullPhone };
};

export default function Settings() {
  const { t } = useTranslation();
  const { user, userRole, theme, setTheme, language, setLanguage, notificationPreferences, setNotificationPreferences, notificationsLoading } = useApp();

  const parsedPhone = parsePhone(user?.user_metadata?.phone);

  const [profile, setProfile] = useState({
    name: user?.user_metadata?.name || '',
    email: user?.email || '',
    countryCode: parsedPhone.countryCode,
    phone: parsedPhone.phone,
  });

  // Detect user's country via IP geolocation
  useEffect(() => {
    if (!profile.countryCode || profile.countryCode === '+965') {
      fetch('http://ip-api.com/json/?fields=countryCode')
        .then(res => res.json())
        .then(data => {
          const country = GCC_COUNTRIES.find(c => c.country === data.countryCode);
          if (country) {
            setProfile(prev => ({ ...prev, countryCode: country.code }));
          }
        })
        .catch(() => {}); // Silently fail, keep Kuwait default
    }
  }, [user?.user_metadata?.phone]);

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfile((prev) => ({ ...prev, [name]: value }));
  };

  const handleNotificationChange = async (key) => {
    const newValue = !notificationPreferences?.[key];

    // Optimistic update
    setNotificationPreferences((prev) => ({ ...prev, [key]: newValue }));

    try {
      await notificationPreferencesService.updateSingle(key, newValue);
    } catch (error) {
      console.error('Error saving notification preference:', error);
      // Revert on failure
      setNotificationPreferences((prev) => ({ ...prev, [key]: !newValue }));
    }
  };

  const handleSaveProfile = () => {
    // In production, this would update the profile via API
    console.log('Saving profile:', profile);
  };

  return (
    <div className="settings-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">{t('settings.title')}</h2>
          <p className="page-description">
            {t('settings.subtitle')}
          </p>
        </div>
      </div>

      <div className="settings-grid">
        {/* Profile Section - Only show for managers (barbers have dedicated profile page) */}
        {userRole === 'manager' && (
          <SettingsSection
            icon={User}
            title={t('settings.profile')}
            description={t('settings.profileDescription')}
          >
            <div className="profile-avatar-section">
              <div className="profile-avatar">
                {(user?.user_metadata?.name || 'User').split(' ').map((n) => n[0]).join('')}
              </div>
              <button className="avatar-upload-btn">
                <Camera size={16} strokeWidth={1.5} />
                {t('settings.changePhoto')}
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">{t('common.fullName')}</label>
              <input
                type="text"
                name="name"
                value={profile.name}
                onChange={handleProfileChange}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t('common.email')}</label>
              <input
                type="email"
                name="email"
                value={profile.email}
                onChange={handleProfileChange}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t('common.phone')}</label>
              <div className="phone-input-group">
                <select
                  name="countryCode"
                  value={profile.countryCode}
                  onChange={handleProfileChange}
                  className="form-input form-select country-code-select"
                >
                  {GCC_COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.label}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  name="phone"
                  value={profile.phone}
                  onChange={handleProfileChange}
                  className="form-input phone-number-input"
                  placeholder="XXXX XXXX"
                />
              </div>
            </div>

            <button className="btn btn-primary" onClick={handleSaveProfile}>
              <Save size={16} strokeWidth={1.5} />
              {t('common.saveChanges')}
            </button>
          </SettingsSection>
        )}

        {/* Notifications Section */}
        <SettingsSection
          icon={Bell}
          title={t('settings.notifications')}
          description={t('settings.notificationsDescription')}
        >
          {notificationsLoading ? (
            <div className="settings-loading">{t('settings.loadingPreferences')}</div>
          ) : (
            <>
              {/* Booking Notifications Category */}
              <div className="settings-category-label">{t('nav.bookings')}</div>

              <SettingsItem
                label={t('settings.newBookings')}
                description={t('settings.newBookingsDesc')}
              >
                <Toggle
                  checked={notificationPreferences?.newBookings}
                  onChange={() => handleNotificationChange('newBookings')}
                />
              </SettingsItem>

              <SettingsItem
                label={t('settings.bookingUpdates')}
                description={t('settings.bookingUpdatesDesc')}
              >
                <Toggle
                  checked={notificationPreferences?.bookingUpdates}
                  onChange={() => handleNotificationChange('bookingUpdates')}
                />
              </SettingsItem>

              <SettingsItem
                label={t('settings.cancellations')}
                description={t('settings.cancellationsDesc')}
              >
                <Toggle
                  checked={notificationPreferences?.cancellations}
                  onChange={() => handleNotificationChange('cancellations')}
                />
              </SettingsItem>

              <div className="settings-divider" />

              {/* System Category */}
              <div className="settings-category-label">{t('settings.system')}</div>

              <SettingsItem
                label={t('settings.systemAlerts')}
                description={t('settings.systemAlertsDesc')}
              >
                <Toggle
                  checked={notificationPreferences?.systemAlerts}
                  onChange={() => handleNotificationChange('systemAlerts')}
                />
              </SettingsItem>
            </>
          )}
        </SettingsSection>

        {/* Appearance Section */}
        <SettingsSection
          icon={Palette}
          title={t('settings.appearance')}
          description={t('settings.appearanceDescription')}
        >
          <SettingsItem label={t('settings.theme')}>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="form-input form-select settings-select"
            >
              <option value="dark">{t('settings.themeDark')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="system">{t('settings.themeSystem')}</option>
            </select>
          </SettingsItem>

          <SettingsItem label={t('settings.language')}>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="form-input form-select settings-select"
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </SettingsItem>
        </SettingsSection>

        {/* Security Section */}
        <SettingsSection
          icon={Lock}
          title={t('settings.security')}
          description={t('settings.securityDescription')}
        >
          <button className="settings-link-btn">
            {t('settings.changePassword')}
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>

          <button className="settings-link-btn">
            {t('settings.twoFactor')}
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>

          <button className="settings-link-btn">
            {t('settings.activeSessions')}
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>
        </SettingsSection>

        {/* Help Section */}
        <SettingsSection
          icon={HelpCircle}
          title={t('settings.helpSupport')}
          description={t('settings.helpDescription')}
        >
          <button className="settings-link-btn">
            {t('settings.helpCenter')}
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>

          <button className="settings-link-btn">
            {t('settings.contactSupport')}
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>

          <button className="settings-link-btn">
            {t('settings.featureRequests')}
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>
        </SettingsSection>

        {/* Danger Zone */}
        <div className="danger-zone-container animate-fade-in-up">
          {/* Decorative corner accent */}
          <div className="danger-zone-accent" />

          <div className="danger-zone-header">
            <div className="danger-zone-icon">
              <ShieldAlert size={22} strokeWidth={1.5} />
            </div>
            <div className="danger-zone-title-group">
              <h3>{t('settings.dangerZone')}</h3>
              <p>{t('settings.dangerZoneDesc')}</p>
            </div>
          </div>

          <div className="danger-zone-divider" />

          <div className="danger-zone-content">
            <SignOutCard />
          </div>

          {/* Subtle warning pattern */}
          <div className="danger-zone-pattern" />
        </div>
      </div>
    </div>
  );
}
