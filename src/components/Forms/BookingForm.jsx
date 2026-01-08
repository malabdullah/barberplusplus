import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { TIME_SLOTS } from '../../constants/time';
import { getFilteredTimeSlots, getDateAvailability } from '../../utils/availabilityFiltering';
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

  // Determine mode: manager (has barbers array) or barber (has currentBarber)
  // Manager view = barbers array is passed (even if empty)
  // Barber view = currentBarber object is passed
  const isManagerView = !currentBarber && Array.isArray(barbers);

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
  const [filteredTimeSlots, setFilteredTimeSlots] = useState([]);
  const [dateError, setDateError] = useState(null);

  // Sync form data when booking prop changes (for pre-fill from conversations)
  useEffect(() => {
    if (booking) {
      setFormData(prev => ({
        ...prev,
        customerName: booking.customerName || prev.customerName,
        customerCountryCode: booking.customerCountryCode || prev.customerCountryCode,
        customerPhone: booking.customerPhone || prev.customerPhone,
      }));
    }
  }, [booking]);

  // Get the currently selected barber
  const selectedBarber = useMemo(() => {
    if (!isManagerView) return currentBarber;
    return barbers.find(b => b.id === formData.barberId) || null;
  }, [isManagerView, currentBarber, barbers, formData.barberId]);

  // Calculate totals from selected services
  const selectedServices = services.filter(s => formData.serviceIds.includes(s.id));
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  // Update filtered time slots when date, barber, or duration changes
  useEffect(() => {
    if (!selectedBarber || !formData.date) {
      setFilteredTimeSlots(TIME_SLOTS.map(slot => ({ slot, available: true, reason: null })));
      return;
    }

    const barberId = formData.barberId || currentBarber?.id;
    const barberBookings = existingBookings.filter(b =>
      b.barberId === barberId && !['cancelled', 'no-show'].includes(b.status)
    );

    const slots = getFilteredTimeSlots({
      date: formData.date,
      duration: totalDuration || 30,
      barberData: selectedBarber,
      existingBookings: barberBookings,
      editingBookingId: booking?.id
    });

    setFilteredTimeSlots(slots);

    // Clear time if current selection is now unavailable
    const currentSlot = slots.find(s => s.slot === formData.time);
    if (formData.time && currentSlot && !currentSlot.available) {
      setFormData(prev => ({ ...prev, time: '' }));
    }
  }, [selectedBarber, formData.date, formData.barberId, totalDuration, existingBookings, booking?.id, currentBarber?.id, formData.time]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    // Clear date and time when barber changes
    if (name === 'barberId') {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
        date: format(new Date(), 'yyyy-MM-dd'),
        time: ''
      }));
      setDateError(null);
    } else if (name === 'date') {
      // Validate date availability
      const dateAvailability = getDateAvailability(value, selectedBarber);
      if (!dateAvailability.available) {
        setDateError(t(`bookings.dateReasons.${dateAvailability.reason}`));
        // Keep the invalid date visible but show error, clear time
        setFormData((prev) => ({ ...prev, date: value, time: '' }));
      } else {
        setDateError(null);
        setFormData((prev) => ({ ...prev, date: value, time: '' }));
      }
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }

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
    if (isManagerView) {
      if (barbers.length === 0) {
        newErrors.barberId = t('bookings.noBarbersAvailable');
      } else if (!formData.barberId) {
        newErrors.barberId = t('bookings.validation.barberRequired');
      }
    }

    if (!formData.serviceIds.length) {
      newErrors.serviceIds = t('bookings.validation.serviceRequired');
    }

    if (!formData.date) {
      newErrors.date = t('bookings.validation.dateRequired');
    } else if (dateError) {
      newErrors.date = dateError;
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
      const submitData = {
        ...formData,
        duration: totalDuration,
        price: totalPrice,
      };
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
              {barbers.length > 0 ? (
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
              ) : (
                <div className="form-empty-state">
                  <span className="form-error">{t('bookings.noBarbersAvailable')}</span>
                </div>
              )}
              {errors.barberId && <span className="form-error">{errors.barberId}</span>}
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">{t('bookings.services')}</label>
          {services.length > 0 ? (
            <>
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
              {formData.serviceIds.length > 0 && (
                <div className="services-total">
                  <span>{t('common.total')}:</span>
                  <span className="services-total-value">{totalDuration} {t('common.min')} - {totalPrice} {t('common.currency')}</span>
                </div>
              )}
            </>
          ) : (
            <div className="form-empty-state">
              <span className="form-hint">{t('bookings.noServicesAvailable')}</span>
            </div>
          )}
          {errors.serviceIds && <span className="form-error">{errors.serviceIds}</span>}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('bookings.date')}</label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              onClick={(e) => e.target.showPicker()}
              min={format(new Date(), 'yyyy-MM-dd')}
              max={selectedBarber ? format(addDays(new Date(), selectedBarber.maxBookingDays || 30), 'yyyy-MM-dd') : undefined}
              disabled={isManagerView && !formData.barberId}
              className={`form-input ${errors.date || dateError ? 'error' : ''}`}
            />
            {isManagerView && !formData.barberId && (
              <span className="form-hint">{t('bookings.selectBarberFirst')}</span>
            )}
            {dateError && <span className="form-error">{dateError}</span>}
            {errors.date && !dateError && <span className="form-error">{errors.date}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">{t('bookings.time')}</label>
            <select
              name="time"
              value={formData.time}
              onChange={handleChange}
              disabled={!formData.date || (isManagerView && !formData.barberId)}
              className={`form-input form-select ${errors.time ? 'error' : ''}`}
            >
              <option value="">{t('bookings.selectTime')}</option>
              {filteredTimeSlots.map(({ slot, available, reason }) => (
                <option key={slot} value={slot} disabled={!available}>
                  {slot} {!available ? `(${t(`bookings.timeReasons.${reason}`)})` : ''}
                </option>
              ))}
            </select>
            {!formData.date && (
              <span className="form-hint">{t('bookings.selectDateFirst')}</span>
            )}
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
