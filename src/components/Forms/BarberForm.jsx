import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera } from 'lucide-react';
import { GCC_COUNTRIES } from '../../constants/countries';
import './Forms.css';

export default function BarberForm({ barber, services = [], onSubmit, onCancel, isSubmitting = false }) {
  const { t } = useTranslation();
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

  // Detect user's country via IP geolocation
  useEffect(() => {
    if (!barber?.countryCode) {
      fetch('https://ipapi.co/json/')
        .then(res => res.json())
        .then(data => {
          const country = GCC_COUNTRIES.find(c => c.country === data.country_code);
          if (country) {
            setFormData(prev => ({ ...prev, countryCode: country.code }));
          }
        })
        .catch(() => {}); // Silently fail, keep Kuwait default
    }
  }, [barber?.countryCode]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    setFormData((prev) => ({ ...prev, [name]: newValue }));
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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-section">
        <h4 className="form-section-title">{t('profile.title')}</h4>

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
              accept="image/*"
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

      <div className="form-section">
        <h4 className="form-section-title">{t('barbers.assignedServices')}</h4>

        {services.length > 0 ? (
          <div className="services-select">
            {services.map((service) => (
              <label key={service.id} className="service-checkbox">
                <input
                  type="checkbox"
                  checked={formData.services.includes(service.id)}
                  onChange={() => toggleService(service.id)}
                />
                <span>{service.name}</span>
                <span className="service-price">{service.price} {t('common.currency')}</span>
              </label>
            ))}
          </div>
        ) : (
          <span className="form-hint">{t('barbers.noServicesAvailable')}</span>
        )}
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? t('common.loading') : (barber ? t('common.saveChanges') : t('barbers.addBarber'))}
        </button>
      </div>
    </form>
  );
}
