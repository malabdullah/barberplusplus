import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './Forms.css';

export default function ServiceForm({ service, onSubmit, onCancel, isSubmitting = false }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: service?.name || '',
    description: service?.description || '',
    duration: service?.duration || 30,
    price: service?.price || 0,
  });

  const [errors, setErrors] = useState({});
  const formRef = useRef(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'duration' || name === 'price' ? Number(value) : value,
    }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = t('validation.serviceNameRequired');
    if (!Number.isInteger(formData.duration) || formData.duration < 5 || formData.duration > 480) newErrors.duration = t('validation.durationMin');
    if (!Number.isFinite(formData.price) || formData.price < 0 || formData.price > 10000 || Math.abs(formData.price * 1000 - Math.round(formData.price * 1000)) > 0.00001) newErrors.price = t('validation.priceNegative');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    } else {
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
    }
  };

  return (
    <form ref={formRef} className="form" onSubmit={handleSubmit} noValidate>
      <div className="form-group">
        <label className="form-label" htmlFor="service-name">{t('services.name')}</label>
        <input
          type="text"
          name="name"
          id="service-name"
          aria-required="true"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "service-name-error" : undefined}
          value={formData.name}
          onChange={handleChange}
          className={`form-input ${errors.name ? 'error' : ''}`}
          placeholder={t('services.namePlaceholder')}
        />
        {errors.name && <span id="service-name-error" className="form-error" role="alert">{errors.name}</span>}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="service-description">{t('common.description')}</label>
        <textarea
          name="description"
          id="service-description"
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? "service-description-error" : undefined}
          value={formData.description}
          onChange={handleChange}
          className="form-input form-textarea"
          placeholder={t('services.descriptionPlaceholder')}
          rows={3}
        />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="service-duration">{t('services.duration')}</label>
          <input
            type="number"
            name="duration"
          id="service-duration"
          aria-required="true"
          aria-invalid={Boolean(errors.duration)}
          aria-describedby={errors.duration ? "service-duration-error" : undefined}
            value={formData.duration}
            onChange={handleChange}
            className={`form-input ${errors.duration ? 'error' : ''}`}
            min="5"
            step="1"
            max="480"
          />
          {errors.duration && <span id="service-duration-error" className="form-error" role="alert">{errors.duration}</span>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="service-price">{t('services.price')} ({t('common.currency')})</label>
          <input
            type="number"
            name="price"
          id="service-price"
          aria-required="true"
          aria-invalid={Boolean(errors.price)}
          aria-describedby={errors.price ? "service-price-error" : undefined}
            value={formData.price}
            onChange={handleChange}
            className={`form-input ${errors.price ? 'error' : ''}`}
            min="0"
            step="0.001"
            max="10000"
          />
          {errors.price && <span id="service-price-error" className="form-error" role="alert">{errors.price}</span>}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? t('common.loading') : (service ? t('common.saveChanges') : t('services.addService'))}
        </button>
      </div>
    </form>
  );
}

