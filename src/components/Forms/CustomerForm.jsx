import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GCC_COUNTRIES } from '../../constants/countries';
import { useGeoLocation } from '../../hooks/useGeoLocation';
import { validatePhoneNumber } from '../../utils/validation';

/**
 * CustomerForm component for creating/editing customers
 *
 * @param {Object} props
 * @param {Object} [props.customer] - Existing customer to edit (optional)
 * @param {Array} [props.branches] - List of branches for preferred branch selector
 * @param {Array} [props.barbers] - List of barbers for preferred barber selector
 * @param {Function} props.onSubmit - Callback when form is submitted
 * @param {Function} props.onCancel - Callback when form is cancelled
 * @param {boolean} [props.loading] - Whether form submission is in progress
 */
function CustomerForm({ customer, branches = [], barbers = [], onSubmit, onCancel, loading = false }) {
  const { t } = useTranslation();

  // Use geolocation hook for initial country code
  const { dialCode } = useGeoLocation(customer?.countryCode);

  const [formData, setFormData] = useState({
    name: customer?.name || '',
    nameAr: customer?.nameAr || '',
    countryCode: customer?.countryCode || dialCode,
    phone: customer?.phone || '',
    email: customer?.email || '',
    notes: customer?.notes || '',
    tags: customer?.tags?.join(', ') || '',
    preferredBranchId: customer?.preferredBranchId || '',
    preferredBarberId: customer?.preferredBarberId || '',
    status: customer?.status || 'active',
  });

  const [errors, setErrors] = useState({});

  // Update country code when geolocation resolves
  useEffect(() => {
    if (!customer?.countryCode && dialCode) {
      setFormData(prev => ({
        ...prev,
        countryCode: dialCode,
      }));
    }
  }, [dialCode, customer?.countryCode]);

  // Filter barbers by selected branch
  const filteredBarbers = formData.preferredBranchId
    ? barbers.filter(b => b.branchId === formData.preferredBranchId)
    : barbers;

  const handleChange = (e) => {
    const { name, value } = e.target;

    // Clear preferred barber when branch changes
    if (name === 'preferredBranchId') {
      setFormData(prev => ({
        ...prev,
        [name]: value,
        preferredBarberId: '',
      }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }

    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: null }));
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = t('agent.customers.validation.nameRequired');
    }

    if (!formData.phone.trim()) {
      newErrors.phone = t('agent.customers.validation.phoneRequired');
    } else {
      const phoneValidation = validatePhoneNumber(
        formData.phone,
        formData.countryCode
      );
      if (!phoneValidation.valid) {
        newErrors.phone = t('agent.customers.validation.phoneInvalid');
      }
    }

    // Validate email format if provided
    if (formData.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        newErrors.email = t('validation.invalidEmail', 'Invalid email format');
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      // Parse tags from comma-separated string
      const tags = formData.tags
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

      const submitData = {
        name: formData.name.trim(),
        nameAr: formData.nameAr.trim() || null,
        countryCode: formData.countryCode,
        phone: formData.phone.trim(),
        email: formData.email.trim() || null,
        notes: formData.notes.trim() || null,
        tags,
        preferredBranchId: formData.preferredBranchId || null,
        preferredBarberId: formData.preferredBarberId || null,
        status: formData.status,
      };

      onSubmit(submitData);
    }
  };

  const isEditing = !!customer?.id;

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-section">
        <h4 className="form-section-title">{t('agent.customers.form.customerInfo', 'Customer Information')}</h4>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('agent.customers.form.name')}</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className={`form-input ${errors.name ? 'error' : ''}`}
              placeholder={t('agent.customers.form.namePlaceholder')}
              disabled={loading}
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">{t('agent.customers.form.nameAr')}</label>
            <input
              type="text"
              name="nameAr"
              value={formData.nameAr}
              onChange={handleChange}
              className="form-input"
              placeholder={t('agent.customers.form.nameArPlaceholder', 'e.g., محمد')}
              dir="rtl"
              disabled={loading}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('agent.customers.form.phone')}</label>
            <div className="phone-input-group">
              <select
                name="countryCode"
                value={formData.countryCode}
                onChange={handleChange}
                className="form-input form-select country-code-select"
                disabled={loading}
              >
                {GCC_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {t(`countries.${country.country}`)} ({country.code})
                  </option>
                ))}
              </select>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className={`form-input phone-number-input ${errors.phone ? 'error' : ''}`}
                placeholder={t('bookings.phonePlaceholder', '5xxxxxxxx')}
                disabled={loading}
              />
            </div>
            {errors.phone && <span className="form-error">{errors.phone}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">{t('agent.customers.form.email')}</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className={`form-input ${errors.email ? 'error' : ''}`}
              placeholder={t('agent.customers.form.emailPlaceholder')}
              disabled={loading}
            />
            {errors.email && <span className="form-error">{errors.email}</span>}
          </div>
        </div>
      </div>

      <div className="form-section">
        <h4 className="form-section-title">{t('agent.customers.form.preferences', 'Preferences')}</h4>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('agent.customers.form.preferredBranch')}</label>
            <select
              name="preferredBranchId"
              value={formData.preferredBranchId}
              onChange={handleChange}
              className="form-input form-select"
              disabled={loading}
            >
              <option value="">{t('common.none')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">{t('agent.customers.form.preferredBarber')}</label>
            <select
              name="preferredBarberId"
              value={formData.preferredBarberId}
              onChange={handleChange}
              className="form-input form-select"
              disabled={loading || filteredBarbers.length === 0}
            >
              <option value="">{t('common.none')}</option>
              {filteredBarbers.map((barber) => (
                <option key={barber.id} value={barber.id}>
                  {barber.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('agent.customers.form.tags')}</label>
          <input
            type="text"
            name="tags"
            value={formData.tags}
            onChange={handleChange}
            className="form-input"
            placeholder={t('agent.customers.form.tagsPlaceholder')}
            disabled={loading}
          />
          <span className="form-hint">{t('agent.customers.form.tagsHint', 'Separate tags with commas')}</span>
        </div>
      </div>

      <div className="form-section">
        <h4 className="form-section-title">{t('agent.customers.form.additionalInfo', 'Additional Information')}</h4>

        <div className="form-group">
          <label className="form-label">{t('agent.customers.form.notes')}</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            className="form-input form-textarea"
            placeholder={t('agent.customers.form.notesPlaceholder')}
            rows={3}
            disabled={loading}
          />
        </div>

        {isEditing && (
          <div className="form-group">
            <label className="form-label">{t('agent.customers.form.status')}</label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="form-input form-select"
              disabled={loading}
            >
              <option value="active">{t('common.active')}</option>
              <option value="inactive">{t('common.inactive')}</option>
              <option value="blocked">{t('agent.customers.form.blocked', 'Blocked')}</option>
            </select>
          </div>
        )}
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={loading}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
        >
          {loading ? t('common.saving') : (isEditing ? t('common.update') : t('common.create'))}
        </button>
      </div>
    </form>
  );
}

export default CustomerForm;
