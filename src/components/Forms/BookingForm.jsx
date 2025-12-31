import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { format } from 'date-fns';
import { TIME_SLOTS } from '../../constants/time';
import { GCC_COUNTRIES } from '../../constants/countries';
import { useGeoLocation } from '../../hooks/useGeoLocation';
import { validatePhoneNumber } from '../../utils/validation';
import { checkBookingConflicts } from '../../utils/bookingConflicts';

/**
 * Shared BookingForm component for both manager and barber views
 *
 * @param {Object} props
 * @param {Object} [props.booking] - Existing booking to edit (optional)
 * @param {Array} [props.barbers] - List of barbers (manager view only)
 * @param {Object} [props.currentBarber] - Current barber (barber view only)
 * @param {Array} props.services - List of available services
 * @param {Array} [props.existingBookings] - Existing bookings to check for conflicts
 * @param {Function} props.onSubmit - Callback when form is submitted
 * @param {Function} props.onCancel - Callback when form is cancelled
 */
function BookingForm({ booking, barbers, currentBarber, services, existingBookings = [], onSubmit, onCancel }) {
  const { t } = useTranslation();

  // Determine mode: manager (has barbers list) or barber (has currentBarber)
  const isManagerView = !!barbers && barbers.length > 0;

  // Use geolocation hook for initial country code
  const { dialCode } = useGeoLocation(booking?.customerCountryCode);

  const [formData, setFormData] = useState({
    customerName: booking?.customerName || '',
    customerCountryCode: booking?.customerCountryCode || dialCode,
    customerPhone: booking?.customerPhone || '',
    barberId: booking?.barberId || (currentBarber?.id || ''),
    serviceIds: booking?.serviceIds || [],
    date: booking?.date || format(new Date(), 'yyyy-MM-dd'),
    time: booking?.time || '09:00',
    notes: booking?.notes || '',
  });

  const [errors, setErrors] = useState({});

  // Calculate totals from selected services
  const selectedServices = services.filter(s => formData.serviceIds.includes(s.id));
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const toggleService = (serviceId) => {
    setFormData((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(serviceId)
        ? prev.serviceIds.filter(id => id !== serviceId)
        : [...prev.serviceIds, serviceId]
    }));
    if (errors.serviceIds) {
      setErrors((prev) => ({ ...prev, serviceIds: null }));
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.customerName.trim()) {
      newErrors.customerName = t('bookings.validation.customerNameRequired');
    }

    if (!formData.customerPhone.trim()) {
      newErrors.customerPhone = t('bookings.validation.phoneRequired');
    } else {
      const phoneValidation = validatePhoneNumber(
        formData.customerPhone,
        formData.customerCountryCode
      );
      if (!phoneValidation.valid) {
        newErrors.customerPhone = phoneValidation.error;
      }
    }

    // Only validate barberId in manager view
    if (isManagerView && !formData.barberId) {
      newErrors.barberId = t('bookings.validation.barberRequired');
    }

    if (!formData.serviceIds.length) {
      newErrors.serviceIds = t('bookings.validation.serviceRequired');
    }

    if (!formData.date) {
      newErrors.date = t('bookings.validation.dateRequired');
    }

    if (!formData.time) {
      newErrors.time = t('bookings.validation.timeRequired');
    }

    // Check for booking conflicts
    const barberToCheck = isManagerView
      ? barbers.find(b => b.id === formData.barberId)
      : currentBarber;

    const effectiveBarberId = formData.barberId || currentBarber?.id;

    if (barberToCheck && formData.date && formData.time && totalDuration > 0 && effectiveBarberId) {
      const conflict = checkBookingConflicts({
        barberId: effectiveBarberId,
        date: formData.date,
        time: formData.time,
        duration: totalDuration,
        existingBookings,
        barberData: barberToCheck,
        editingBookingId: booking?.id,
      });

      if (conflict.hasConflict) {
        newErrors.time = conflict.reason;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      const submitData = { ...formData };
      // In barber view, ensure barberId is set
      if (!isManagerView && currentBarber) {
        submitData.barberId = currentBarber.id;
      }
      onSubmit(submitData);
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-section">
        <h4 className="form-section-title">{t('bookings.customerInformation')}</h4>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('bookings.customerName')}</label>
            <input
              type="text"
              name="customerName"
              value={formData.customerName}
              onChange={handleChange}
              className={`form-input ${errors.customerName ? 'error' : ''}`}
              placeholder={t('bookings.namePlaceholder')}
            />
            {errors.customerName && <span className="form-error">{errors.customerName}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">{t('bookings.phoneNumber')}</label>
            <div className="phone-input-group">
              <select
                name="customerCountryCode"
                value={formData.customerCountryCode}
                onChange={handleChange}
                className="form-input form-select country-code-select"
              >
                {GCC_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {t(`countries.${country.country}`)} ({country.code})
                  </option>
                ))}
              </select>
              <input
                type="tel"
                name="customerPhone"
                value={formData.customerPhone}
                onChange={handleChange}
                className={`form-input phone-number-input ${errors.customerPhone ? 'error' : ''}`}
                placeholder={t('bookings.phonePlaceholder')}
              />
            </div>
            {errors.customerPhone && <span className="form-error">{errors.customerPhone}</span>}
          </div>
        </div>
      </div>

      <div className="form-section">
        <h4 className="form-section-title">{t('bookings.bookingDetails')}</h4>

        {/* Barber selection - only in manager view */}
        {isManagerView && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t('bookings.barber')}</label>
              <select
                name="barberId"
                value={formData.barberId}
                onChange={handleChange}
                className={`form-input form-select ${errors.barberId ? 'error' : ''}`}
              >
                <option value="">{t('bookings.selectBarberPlaceholder')}</option>
                {barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.name}
                  </option>
                ))}
              </select>
              {errors.barberId && <span className="form-error">{errors.barberId}</span>}
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">{t('bookings.services')}</label>
          <div className={`services-select-grid ${errors.serviceIds ? 'error' : ''}`}>
            {services.map((service) => {
              const isSelected = formData.serviceIds.includes(service.id);
              return (
                <label
                  key={service.id}
                  className={`service-checkbox-card ${isSelected ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleService(service.id)}
                  />
                  <div className="service-checkbox-content">
                    <span className="service-checkbox-name">{service.name}</span>
                    <span className="service-checkbox-meta">
                      {service.duration} {t('common.min')} - {service.price} {t('common.currency')}
                    </span>
                  </div>
                  <div className="service-checkbox-check">
                    <Check size={14} strokeWidth={2} />
                  </div>
                </label>
              );
            })}
          </div>
          {errors.serviceIds && <span className="form-error">{errors.serviceIds}</span>}
          {formData.serviceIds.length > 0 && (
            <div className="services-total">
              <span>{t('common.total')}:</span>
              <span className="services-total-value">{totalDuration} {t('common.min')} - {totalPrice} {t('common.currency')}</span>
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('bookings.date')}</label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              className={`form-input ${errors.date ? 'error' : ''}`}
            />
            {errors.date && <span className="form-error">{errors.date}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">{t('bookings.time')}</label>
            <select
              name="time"
              value={formData.time}
              onChange={handleChange}
              className={`form-input form-select ${errors.time ? 'error' : ''}`}
            >
              {TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
            {errors.time && <span className="form-error">{errors.time}</span>}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('bookings.notesLabel')}</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            className="form-input form-textarea"
            placeholder={t('bookings.notesPlaceholder')}
            rows={2}
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary">
          {booking ? t('bookings.updateBooking') : t('bookings.createBooking')}
        </button>
      </div>
    </form>
  );
}

export default BookingForm;
