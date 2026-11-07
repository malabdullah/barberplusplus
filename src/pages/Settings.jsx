import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
  FileText,
  Scissors,
} from 'lucide-react';
import ManagerSocialAccounts from '../components/Customer/ManagerSocialAccounts';
import SignOutCard from '../components/UI/SignOutCard';
import { useApp } from '../context/AppContext';
import { GCC_COUNTRIES } from '../constants/countries';
import { getErrorMessage } from '../utils/errorMessages';
import { storageService } from '../services/storage.service';
import { validatePhoneNumber } from '../utils/validation';
import { notificationPreferencesService } from '../services';
import { useGeoLocation } from '../hooks/useGeoLocation';
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

function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      className={`toggle ${checked ? 'active' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      aria-busy={disabled}
      aria-label={label}
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
  const navigate = useNavigate();
  const { user, userRole, saveWorkProfile, theme, setTheme, language, setLanguage, notificationPreferences, setNotificationPreferences, notificationsLoading, reloadNotifications } = useApp();

  const parsedPhone = parsePhone(user?.user_metadata?.phone);
  // Use cached geolocation hook instead of direct API call
  const { dialCode: detectedCountryCode } = useGeoLocation(parsedPhone.countryCode);

  const [profile, setProfile] = useState({
    name: user?.user_metadata?.name || '',
    email: user?.email || '',
    countryCode: parsedPhone.countryCode,
    phone: parsedPhone.phone,
  });

  // Update country code when geolocation hook returns detected country
  useEffect(() => {
    if (detectedCountryCode && !profile.countryCode) {
      setProfile(prev => ({ ...prev, countryCode: detectedCountryCode }));
    }
  }, [detectedCountryCode, profile.countryCode]);

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfile((prev) => ({ ...prev, [name]: value }));
  };

  const [savingNotificationPreference, setSavingNotificationPreference] = useState(false);
  const handleNotificationChange = async (key) => {
    if (savingNotificationPreference) return;
    setSavingNotificationPreference(true);
    const newValue = !notificationPreferences?.[key];

    // Optimistic update
    setNotificationPreferences((prev) => ({ ...prev, [key]: newValue }));

    try {
      const saved = await notificationPreferencesService.updateSingle(key, newValue);
      setNotificationPreferences(saved);
      await reloadNotifications();
    } catch (error) {
      console.error('Error saving notification preference:', error);
      // Revert on failure
      setNotificationPreferences((prev) => ({ ...prev, [key]: !newValue }));
    } finally {
      setSavingNotificationPreference(false);
    }
  };

  const photoInput = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const handlePhoto = event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      storageService.validateFile(file);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhoto(file); setPhotoPreview(URL.createObjectURL(file)); setProfileError('');
    } catch (error) { setProfileError(getErrorMessage(error, t('common.error'), t)); event.target.value = ''; }
  };
  const handleSaveProfile = async () => {
    if (profileSaving) return;
    setProfileError(''); setProfileSaved(false);
    if (profile.name.trim().length < 2 || profile.name.trim().length > 120) { setProfileError(t('managerAudit.nameLength')); return; }
    if (!validatePhoneNumber(profile.phone, profile.countryCode).valid) { setProfileError(t('validation.invalidPhone')); return; }
    setProfileSaving(true);
    let uploaded;
    try {
      if (photo) uploaded = await storageService.uploadImage(photo, 'profiles', user.id);
      await saveWorkProfile(profile, uploaded || null);
      if (uploaded && user.user_metadata.avatar_url) await storageService.deleteImage(user.user_metadata.avatar_url);
      setPhoto(null); setProfileSaved(true);
    } catch (error) {
      if (uploaded) await storageService.deleteImage(uploaded).catch(() => {});
      setProfileError(getErrorMessage(error, t('common.error'), t));
    } finally { setProfileSaving(false); }
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
                {photoPreview || user?.user_metadata?.avatar_url
                  ? <img src={photoPreview || user.user_metadata.avatar_url} alt={profile.name} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'inherit'}} />
                  : (user?.user_metadata?.name || 'User').split(' ').map((n) => n[0]).join('') }
              </div>
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handlePhoto} hidden />
              <button className="avatar-upload-btn" type="button" disabled={profileSaving} onClick={() => photoInput.current?.click()}>
                <Camera size={16} strokeWidth={1.5} />
                {t('settings.changePhoto')}
              </button>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="manager-name">{t('common.fullName')}</label>
              <input
                type="text"
                name="name" id="manager-name"
                value={profile.name}
                onChange={handleProfileChange}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="manager-email">{t('common.email')}</label>
              <input
                type="email"
                name="email" id="manager-email"
                value={profile.email}
                readOnly
                className="form-input"
              />
              <p className="form-help">{t('accountEmail.adminOnly')}</p>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="manager-phone">{t('common.phone')}</label>
              <div className="phone-input-group">
                <select
                  name="countryCode" aria-label={t('customerAuth.countryCode')}
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
                  name="phone" id="manager-phone"
                  value={profile.phone}
                  onChange={handleProfileChange}
                  className="form-input phone-number-input"
                  placeholder="XXXX XXXX"
                />
              </div>
            </div>

            {profileError && <p role="alert" className="form-error">{profileError}</p>}
            {profileSaved && <p role="status">{t('managerAudit.profileSaved')}</p>}
            <button className="btn btn-primary" disabled={profileSaving} onClick={handleSaveProfile}>
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
                  disabled={savingNotificationPreference}
                  checked={notificationPreferences?.newBookings}
                  label={t('settings.newBookings')}
                  onChange={() => handleNotificationChange('newBookings')}
                />
              </SettingsItem>

              <SettingsItem
                label={t('settings.bookingUpdates')}
                description={t('settings.bookingUpdatesDesc')}
              >
                <Toggle
                  disabled={savingNotificationPreference}
                  checked={notificationPreferences?.bookingUpdates}
                  label={t('settings.bookingUpdates')}
                  onChange={() => handleNotificationChange('bookingUpdates')}
                />
              </SettingsItem>

              <SettingsItem
                label={t('settings.cancellations')}
                description={t('settings.cancellationsDesc')}
              >
                <Toggle
                  disabled={savingNotificationPreference}
                  checked={notificationPreferences?.cancellations}
                  label={t('settings.cancellations')}
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
                  disabled={savingNotificationPreference}
                  checked={notificationPreferences?.systemAlerts}
                  label={t('settings.systemAlerts')}
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
          <button className="settings-link-btn" onClick={() => navigate('/change-password')}>
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

        {userRole === 'manager' && <SettingsSection icon={User} title={t('teamAuth.connectTitle')} description={t('teamAuth.connectDescription')}><ManagerSocialAccounts /></SettingsSection>}

        {userRole === 'manager' && (
          <SettingsSection icon={Scissors} title={t('chair.title')} description={t('chair.settingsDescription')}>
            <button className="settings-link-btn" onClick={() => navigate('/dashboard/my-chair')}>
              {t('chair.open')}
              <ChevronRight size={16} strokeWidth={1.5} />
            </button>
          </SettingsSection>
        )}

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

        {/* Activity Section */}
        <SettingsSection
          icon={FileText}
          title={t('settings.activity')}
          description={t('settings.activityDescription')}
        >
          <button
            className="settings-link-btn"
            onClick={() => navigate(userRole === 'manager' ? '/logs' : '/barber/logs')}
          >
            {t('settings.viewActivity')}
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
