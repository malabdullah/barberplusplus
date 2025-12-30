import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User,
  Camera,
  Mail,
  Phone,
  Scissors,
  Save,
  Check,
  MapPin,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { GCC_COUNTRIES } from '../../constants/countries';
import './MyProfile.css';

export default function MyProfile() {
  const { t } = useTranslation();
  const { currentBarber, barberBranch, barberServices, updateBarber } = useApp();

  const [formData, setFormData] = useState({
    name: '',
    nameAr: '',
    email: '',
    countryCode: '+965',
    phone: '',
    profilePicture: null, // Existing URL or preview URL
    profilePictureFile: null, // New file to upload
    services: [],
  });

  const [errors, setErrors] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (currentBarber) {
      setFormData({
        name: currentBarber.name || '',
        nameAr: currentBarber.nameAr || '',
        email: currentBarber.email || '',
        countryCode: currentBarber.countryCode || '+965',
        phone: currentBarber.phone || '',
        profilePicture: currentBarber.profilePicture || currentBarber.avatarUrl || null,
        profilePictureFile: null,
        services: currentBarber.services || [],
      });
    }
  }, [currentBarber]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setHasChanges(true);
    setSaveStatus(null);
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Create object URL for preview (more efficient than base64)
      const previewUrl = URL.createObjectURL(file);
      setFormData(prev => ({
        ...prev,
        profilePicture: previewUrl,
        profilePictureFile: file,
      }));
      setHasChanges(true);
      setSaveStatus(null);
    }
  };

  const toggleService = (serviceId) => {
    setFormData(prev => ({
      ...prev,
      services: prev.services.includes(serviceId)
        ? prev.services.filter(id => id !== serviceId)
        : [...prev.services, serviceId]
    }));
    setHasChanges(true);
    setSaveStatus(null);
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = t('validation.nameRequired');
    if (!formData.email.trim()) {
      newErrors.email = t('validation.emailRequired');
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = t('validation.invalidEmail');
    }
    if (!formData.phone.trim()) {
      newErrors.phone = t('validation.phoneRequired');
    } else {
      const country = GCC_COUNTRIES.find(c => c.code === formData.countryCode);
      if (country && !country.pattern.test(formData.phone.replace(/\s/g, ''))) {
        newErrors.phone = t('validation.invalidPhone');
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validate() && !isSubmitting) {
      setIsSubmitting(true);
      try {
        await updateBarber(currentBarber.id, formData);
        setHasChanges(false);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 3000);
      } catch (error) {
        console.error('Error updating profile:', error);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  if (!currentBarber) return null;

  return (
    <div className="profile-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">{t('nav.myProfile')}</h2>
          <p className="page-description">
            {t('profile.updatePersonalInfo')}
          </p>
        </div>
        <button
          className={`btn btn-primary ${!hasChanges || isSubmitting ? 'disabled' : ''}`}
          onClick={handleSubmit}
          disabled={!hasChanges || isSubmitting}
        >
          {isSubmitting ? (
            t('common.saving')
          ) : (
            <>
              <Save size={18} strokeWidth={2} />
              {t('common.saveChanges')}
            </>
          )}
        </button>
      </div>

      {saveStatus === 'saved' && (
        <div className="save-notification animate-fade-in">
          <Check size={16} strokeWidth={2} />
          <span>{t('profile.profileSaved')}</span>
        </div>
      )}

      <form className="profile-form" onSubmit={handleSubmit}>
        {/* Profile Picture & Info Card */}
        <div className="profile-card animate-fade-in-up stagger-1">
          <div className="profile-picture-section">
            <div className="profile-picture-large">
              {formData.profilePicture ? (
                <img src={formData.profilePicture} alt="Profile" />
              ) : (
                <div className="profile-picture-initials">
                  {formData.name ? formData.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'BB'}
                </div>
              )}
              <label className="profile-picture-edit">
                <Camera size={18} strokeWidth={1.5} />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
            <div className="profile-info-summary">
              <h3>{currentBarber.name}</h3>
              <span className="profile-role">{t('profile.barber')}</span>
              <div className="profile-branch">
                <MapPin size={14} strokeWidth={1.5} />
                <span>{barberBranch?.name}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Basic Information */}
        <div className="profile-section animate-fade-in-up stagger-2">
          <div className="profile-section-header">
            <User size={20} strokeWidth={1.5} />
            <h3>{t('profile.basicInformation')}</h3>
          </div>

          <div className="profile-section-content">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">{t('common.fullName')}</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={`form-input ${errors.name ? 'error' : ''}`}
                  placeholder={t('barbers.namePlaceholder')}
                />
                {errors.name && <span className="form-error">{errors.name}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">{t('barbers.nameAr')}</label>
                <input
                  type="text"
                  name="nameAr"
                  value={formData.nameAr}
                  onChange={handleChange}
                  className="form-input"
                  placeholder="مثال: جون سميث"
                  dir="rtl"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="profile-section animate-fade-in-up stagger-3">
          <div className="profile-section-header">
            <Mail size={20} strokeWidth={1.5} />
            <h3>{t('profile.contactInformation')}</h3>
          </div>

          <div className="profile-section-content">
            <div className="form-group">
              <label className="form-label">{t('common.email')}</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className={`form-input ${errors.email ? 'error' : ''}`}
                placeholder="barber@example.com"
              />
              {errors.email && <span className="form-error">{errors.email}</span>}
            </div>

            <div className="form-group">
              <label className="form-label">{t('common.phone')}</label>
              <div className="phone-input-group">
                <select
                  name="countryCode"
                  value={formData.countryCode}
                  onChange={handleChange}
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
                  value={formData.phone}
                  onChange={handleChange}
                  className={`form-input phone-number-input ${errors.phone ? 'error' : ''}`}
                  placeholder="XXXX XXXX"
                />
              </div>
              {errors.phone && <span className="form-error">{errors.phone}</span>}
            </div>
          </div>
        </div>

        {/* Services */}
        <div className="profile-section animate-fade-in-up stagger-4">
          <div className="profile-section-header">
            <Scissors size={20} strokeWidth={1.5} />
            <h3>{t('profile.myServices')}</h3>
          </div>

          <div className="profile-section-content">
            <p className="profile-section-desc">
              {t('profile.selectServicesDescription')}
            </p>

            {barberServices.length > 0 ? (
              <div className="services-grid">
                {barberServices.map((service) => (
                  <label
                    key={service.id}
                    className={`service-card ${formData.services.includes(service.id) ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.services.includes(service.id)}
                      onChange={() => toggleService(service.id)}
                    />
                    <div className="service-card-content">
                      <span className="service-name">{service.name}</span>
                      <div className="service-meta">
                        <span>{service.duration} {t('common.min')}</span>
                        <span className="service-price">{service.price} {t('common.currency')}</span>
                      </div>
                    </div>
                    <div className="service-check">
                      <Check size={16} strokeWidth={2} />
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="no-services">{t('profile.noServicesAvailable')}</p>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
