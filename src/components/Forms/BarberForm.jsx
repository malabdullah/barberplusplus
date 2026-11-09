import { validateImageFile } from '../../utils/imageValidation';
import { getErrorMessage as imageErrorMessage } from '../../utils/errorMessages';
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera } from 'lucide-react';
import { GCC_COUNTRIES } from '../../constants/countries';
import { useGeoLocation } from '../../hooks/useGeoLocation';
import ServicePicker from './ServicePicker';
import './Forms.css';

export default function BarberForm({ barber, services = [], onSubmit, onCancel, isSubmitting = false, submissionError = null, onClearError, disabledReason = '' }) {
  const { t } = useTranslation();
  // Use cached geolocation hook instead of direct API call
  const { dialCode: detectedCountryCode } = useGeoLocation(barber?.countryCode);
  const [formData, setFormData] = useState({
    name: barber?.name || '',
    nameAr: barber?.nameAr || '',
    email: barber?.email || '',
    countryCode: barber?.countryCode || '+965',
    phone: barber?.phone || '',
    profilePicture: barber?.profilePicture || barber?.avatarUrl || null, // Existing URL
    profilePictureFile: null, // New file to upload
    isActive: barber?.isActive ?? true,
    services: barber?.services || [],
  });

  const [errors, setErrors] = useState({});
  const formRef = useRef(null);
  const errorRef = useRef(null);
  const phoneError = errors.phone || (submissionError?.field === 'phone' ? submissionError.message : '');
  useEffect(() => {
    if (!submissionError) return;
    if (submissionError.field === 'phone') formRef.current?.elements.namedItem('phone')?.focus();
    else errorRef.current?.focus();
  }, [submissionError]);

  // Update country code when geolocation hook returns detected country
  useEffect(() => {
    if (!barber?.countryCode && detectedCountryCode) {
      setFormData(prev => ({ ...prev, countryCode: detectedCountryCode }));
    }
  }, [barber?.countryCode, detectedCountryCode]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    setFormData((prev) => ({ ...prev, [name]: newValue }));
    onClearError?.();
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      try { validateImageFile(file); } catch (error) { setErrors(previous => ({ ...previous, image: imageErrorMessage(error, t('common.error'), t) })); e.target.value = ''; return; }
      setErrors(previous => ({ ...previous, image: null }));
      // Create object URL for preview (more efficient than base64)
      const previewUrl = URL.createObjectURL(file);
      setFormData(prev => ({
        ...prev,
        profilePicture: previewUrl,
        profilePictureFile: file,
      }));
    }
  };

  const toggleService = (serviceId) => {
    setFormData(prev => ({
      ...prev,
      services: prev.services.includes(serviceId)
        ? prev.services.filter(id => id !== serviceId)
        : [...prev.services, serviceId]
    }));
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = t('validation.nameRequired');
    if (!formData.email.trim()) {
      newErrors.email = t('validation.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
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
    if (formData.isActive && !formData.services.length) newErrors.services = t('managerAudit.servicesRequired');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isSubmitting || disabledReason) return;
    if (validate()) {
      onSubmit({ ...formData, name: formData.name.trim(), email: formData.email.trim().toLowerCase() });
    } else {
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
    }
  };

  return (
    <form ref={formRef} className="form barber-form" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
      <div className="form-section">
        <h4 className="form-section-title">{t('profile.title')}</h4>

        {errors.image && <p role="alert">{errors.image}</p>}
        <div className="profile-picture-upload">
          <div className="profile-picture-preview">
            {formData.profilePicture ? (
              <img src={formData.profilePicture} alt="Profile" />
            ) : (
              <div className="profile-picture-placeholder">
                {formData.name ? formData.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'BB'}
              </div>
            )}
          </div>
          <label className="profile-picture-button">
            <Camera size={16} strokeWidth={1.5} />
            {t('barbers.uploadPhoto')}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      <div className="form-section">
        <h4 className="form-section-title">{t('barbers.basicInfo')}</h4>

        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              name="isActive"
              checked={formData.isActive}
              onChange={handleChange}
            />
            <span>{t('common.active')}</span>
          </label>
          <span className="form-hint">{t('barbers.inactiveHint')}</span>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="barber-name">{t('common.fullName')}</label>
          <input
            type="text"
            name="name"
            id="barber-name"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'barber-name-error' : undefined}
            value={formData.name}
            onChange={handleChange}
            className={`form-input ${errors.name ? 'error' : ''}`}
            placeholder={t('barbers.namePlaceholder')}
          />
          {errors.name && <span className="form-error" id="barber-name-error">{errors.name}</span>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="barber-name-ar">{t('barbers.nameAr')}</label>
          <input
            type="text"
            name="nameAr"
            id="barber-name-ar"
            value={formData.nameAr}
            onChange={handleChange}
            className="form-input"
            placeholder="مثال: جون سميث"
            dir="rtl"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="barber-email">{t('common.email')}</label>
          <input
            type="email"
            name="email"
            id="barber-email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'barber-email-error' : undefined}
            value={formData.email}
            onChange={barber?.id ? undefined : handleChange}
            readOnly={Boolean(barber?.id)}
            className={`form-input ${errors.email ? 'error' : ''}`}
            placeholder="barber@example.com"
          />
          {errors.email && <span className="form-error" id="barber-email-error">{errors.email}</span>}
          {barber?.id && <p className="form-help">{t('accountEmail.adminOnly')}</p>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="barber-phone">{t('common.phone')}</label>
          <div className="phone-input-group">
            <select
              name="countryCode"
              aria-label={t('customerAuth.countryCode')}
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
              id="barber-phone"
              aria-invalid={Boolean(phoneError)}
              aria-describedby={phoneError ? 'barber-phone-error' : undefined}
              value={formData.phone}
              onChange={handleChange}
              className={`form-input phone-number-input ${phoneError ? 'error' : ''}`}
              placeholder="XXXX XXXX"
            />
          </div>
          {phoneError && <span className="form-error" id="barber-phone-error" role="alert">{phoneError}</span>}
        </div>
      </div>

      <div className="form-section">
        {errors.services && <p id="barber-services-error" role="alert" className="form-error">{errors.services}</p>}
        {services.length > 0 ? (
          <ServicePicker label={t('barbers.assignedServices')} services={services.filter(service => service.status !== 'inactive')}
            selectedIds={formData.services} onToggle={toggleService} disabled={isSubmitting} invalid={Boolean(errors.services)} describedBy={errors.services ? 'barber-services-error' : undefined} />
        ) : <span className="form-hint">{t('barbers.noServicesAvailable')}</span>}

      </div>

      {disabledReason && <p className="error-banner" role="alert">{disabledReason}</p>}
      {submissionError && submissionError.field !== 'phone' && <p ref={errorRef} className="error-banner" role="alert" tabIndex={-1}>{submissionError.message}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting || Boolean(disabledReason)}>
          {isSubmitting ? t('common.loading') : (barber ? t('common.saveChanges') : t('barbers.addBarber'))}
        </button>
      </div>
    </form>
  );
}
