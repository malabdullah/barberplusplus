import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, UserPlus, UserCheck, Loader2 } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { TIME_SLOTS } from '../../constants/time';
import { getFilteredTimeSlots, getDateAvailability } from '../../utils/availabilityFiltering';
import { GCC_COUNTRIES } from '../../constants/countries';
import { useGeoLocation } from '../../hooks/useGeoLocation';
import { useCustomerLookup } from '../../hooks/useCustomerLookup';
import { validatePhoneNumber } from '../../utils/validation';
import { checkBookingConflicts } from '../../utils/bookingConflicts';
import { bookingServices } from '../../utils/bookingServices';
import PackagePicker from '../Packages/PackagePicker';
import { packagesService } from '../../services/packages.service';
import { mapPackage } from '../../utils/servicePackages';
import { packageSelection, packageTotals } from '../../utils/servicePackages';
import CustomerSummaryCard from './CustomerSummaryCard';
import { getErrorMessage } from '../../utils/errorMessages';

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
const EMPTY_BOOKINGS = [];

function BookingForm({ booking, initialCustomer, barbers, currentBarber, services, existingBookings = EMPTY_BOOKINGS, onSubmit, onCancel }) {
  const { t } = useTranslation();
  const formRef = useRef(null);

  // Determine mode: manager (has barbers array) or barber (has currentBarber)
  // Manager view = barbers array is passed (even if empty)
  // Barber view = currentBarber object is passed
  const isManagerView = !currentBarber && Array.isArray(barbers);

  // Use geolocation hook for initial country code
  const { dialCode } = useGeoLocation(booking?.customerCountryCode || initialCustomer?.countryCode);

  const [formData, setFormData] = useState({
    customerName: booking?.customerName || initialCustomer?.name || '',
    customerCountryCode: booking?.customerCountryCode || initialCustomer?.countryCode || dialCode,
    customerPhone: booking?.customerPhone || initialCustomer?.phone || '',
    barberId: booking?.barberId || (currentBarber?.id || ''),
    serviceIds: booking?.serviceIds || [],
    packageOfferId: booking?.packageOfferId || '',
    date: booking?.date || format(new Date(), 'yyyy-MM-dd'),
    time: booking?.time?.slice(0, 5) || '09:00',
    notes: booking?.notes || '',
  });

  const [offers, setOffers] = useState([]);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerFailure, setOfferFailure] = useState(false);
  const [historicalOffer, setHistoricalOffer] = useState(() => {
    if (!booking?.packageSnapshot) return null;
    const included = (booking.serviceSnapshot || []).filter(line => booking.packageSnapshot.service_ids.includes(line.id));
    return mapPackage({ ...booking.packageSnapshot, id: booking.packageOfferId,
      duration: included.reduce((sum, line) => sum + Number(line.duration), 0),
      regular_price: included.reduce((sum, line) => sum + Number(line.price), 0) });
  });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filteredTimeSlots, setFilteredTimeSlots] = useState([]);
  const [dateError, setDateError] = useState(null);

  // Customer lookup state
  const contactLocked = Boolean(booking?.customerId || initialCustomer?.id);
  const [customerId, setCustomerId] = useState(booking?.customerId || initialCustomer?.id || null);

  // Customer lookup hook - only active for new bookings (not edit mode)
  const {
    customer: foundCustomer,
    loading: customerLoading,
    isNewCustomer,
  } = useCustomerLookup(
    formData.customerCountryCode,
    formData.customerPhone,
    { debounceMs: 400 }
  );

  // Sync form data when booking prop changes (for pre-fill and edit mode)
  useEffect(() => {
    if (booking) {
      setFormData(prev => ({
        ...prev,
        customerName: booking.customerName || prev.customerName,
        customerCountryCode: booking.customerCountryCode || prev.customerCountryCode,
        customerPhone: booking.customerPhone || prev.customerPhone,
        // Sync booking-specific fields for edit mode
        barberId: booking.barberId || prev.barberId,
        serviceIds: booking.serviceIds || prev.serviceIds,
        packageOfferId: booking.packageOfferId || '',
        date: booking.date || prev.date,
        time: booking.time?.slice(0, 5) || prev.time,
        notes: booking.notes || prev.notes,
      }));
      // Set customerId for edit mode
      if (booking.customerId) {
        setCustomerId(booking.customerId);
      }
    }
  }, [booking]);

  // Auto-fill customer name when existing customer is found (new bookings only)
  useEffect(() => {
    if (foundCustomer && !booking && !initialCustomer?.id) {
      // Auto-fill name from found customer
      setFormData(prev => ({
        ...prev,
        customerName: foundCustomer.name || prev.customerName,
      }));
      setCustomerId(foundCustomer.id);
    } else if (isNewCustomer && !booking && !initialCustomer?.id) {
      // New customer - clear customerId
      setCustomerId(null);
    }
  }, [foundCustomer, isNewCustomer, booking, initialCustomer?.id]);

  // Get the currently selected barber
  const selectedBarber = useMemo(() => {
    if (!isManagerView) return currentBarber;
    return barbers.find(b => b.id === formData.barberId) || null;
  }, [isManagerView, currentBarber, barbers, formData.barberId]);

  useEffect(() => {
    if (!selectedBarber?.branchId) return;
    let active = true;
    setOfferLoading(true); setOfferFailure(false);
    Promise.all([packagesService.staff(selectedBarber.branchId, selectedBarber.id, formData.date), booking?.packageOfferId ? packagesService.terms(booking.id) : Promise.resolve(null)])
      .then(([items, historical]) => { if (active) { setOffers(items); setHistoricalOffer(historical); } })
      .catch(() => { if (active) { setOffers([]); setOfferFailure(true); } }).finally(() => { if (active) setOfferLoading(false); });
    return () => { active = false; };
  }, [selectedBarber?.id, selectedBarber?.branchId, formData.date, booking?.id, booking?.packageOfferId]);
  const selectedOffer = formData.packageOfferId ? (booking?.packageOfferId === formData.packageOfferId ? historicalOffer : offers.find(item => item.id === formData.packageOfferId)) : null;
  const calculatedServices = selectedOffer && booking?.packageOfferId === formData.packageOfferId
    ? services.map(service => ({ ...service, ...bookingServices(booking, services).find(item => item.id === service.id) })) : services;
  const { selectedServices, totalDuration, totalPrice } = useMemo(() => {
    const unchanged = booking && JSON.stringify(formData.serviceIds) === JSON.stringify(booking.serviceIds) && (formData.packageOfferId || '') === (booking.packageOfferId || '');
    const selected = unchanged ? bookingServices(booking, services) : formData.serviceIds.map(id => calculatedServices.find(service => service.id === id)).filter(Boolean);
    const totals = packageTotals(calculatedServices, formData.serviceIds, selectedOffer);
    return { selectedServices: selected, totalDuration: unchanged ? booking.duration : totals.duration, totalPrice: unchanged ? booking.price : totals.price };
  }, [services, calculatedServices, formData.serviceIds, formData.packageOfferId, selectedOffer, booking]);
  function selectOffer(offer) {
    setFormData(current => ({ ...current, packageOfferId: offer?.id || '', serviceIds: packageSelection(current.serviceIds, selectedOffer, offer), time: '' }));
    setSubmitError('');
  }

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
    if (!contactLocked && ['customerPhone', 'customerCountryCode'].includes(name)) setCustomerId(null);

    // Clear date and time when barber changes
    if (name === 'barberId') {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
        date: format(new Date(), 'yyyy-MM-dd'),
        serviceIds: [], packageOfferId: '',
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
    if (selectedOffer?.serviceIds.includes(serviceId)) return;
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
    if (formData.packageOfferId && (!selectedOffer || offerFailure)) newErrors.serviceIds = t('packages.errors.PACKAGE_UNAVAILABLE');

    if (!formData.customerName.trim()) {
      newErrors.customerName = t('bookings.validation.customerNameRequired');
    }

    if (!formData.customerPhone.trim() && !customerId) {
      newErrors.customerPhone = t('bookings.validation.phoneRequired');
    } else if (formData.customerPhone.trim()) {
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (validate()) {
      setSubmitError(''); setSaving(true);
      const submitData = {
        ...formData,
        duration: totalDuration,
        price: totalPrice,
        customerId, // Pass existing customer ID (or null for new customer)
        isNewCustomer, // Flag for AppContext to handle customer creation
      };
      // In barber view, ensure barberId is set
      if (!isManagerView && currentBarber) {
        submitData.barberId = currentBarber.id;
      }
      try { await onSubmit(submitData); }
      catch (error) { setSubmitError(getErrorMessage(error, t('common.error'), t)); }
      finally { setSaving(false); }
    } else {
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
    }
  };

  return (
    <form ref={formRef} className="form" onSubmit={handleSubmit} noValidate>
      {submitError && <p className="error-banner" role="alert">{submitError}</p>}
      <div className="form-section">
        <h4 className="form-section-title">{t('bookings.customerInformation')}</h4>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="staff-booking-customerName">{t('bookings.customerName')}</label>
            <input
              type="text"
              name="customerName"
              id="staff-booking-customerName"
              aria-invalid={Boolean(errors.customerName)}
              aria-describedby={errors.customerName ? 'staff-booking-customerName-error' : undefined}
              readOnly={contactLocked || !!foundCustomer}
              value={formData.customerName}
              onChange={handleChange}
              className={`form-input ${errors.customerName ? 'error' : ''}`}
              placeholder={t('bookings.namePlaceholder')}
            />
            {errors.customerName && <span id="staff-booking-customerName-error" className="form-error" role="alert">{errors.customerName}</span>}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="staff-booking-customerPhone">{t('bookings.phoneNumber')}</label>
            <div className="phone-input-group">
              <select
                name="customerCountryCode"
                aria-label={t('customerAuth.countryCode')}
                disabled={contactLocked}
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
              <div className="phone-input-wrapper">
                <input
                  type="tel"
                  name="customerPhone"
              id="staff-booking-customerPhone"
              aria-invalid={Boolean(errors.customerPhone)}
              aria-describedby={errors.customerPhone ? 'staff-booking-customerPhone-error' : undefined}
                  readOnly={contactLocked}
                  value={formData.customerPhone}
                  onChange={handleChange}
                  className={`form-input phone-number-input ${errors.customerPhone ? 'error' : ''} ${foundCustomer ? 'customer-found' : ''}`}
                  placeholder={t('bookings.phonePlaceholder')}
                />
                {/* Customer lookup status indicator */}
                {!booking && formData.customerPhone.replace(/\s/g, '').length >= 6 && (
                  <span className="phone-input-status">
                    {customerLoading && (
                      <Loader2 size={16} className="spinner" />
                    )}
                    {!customerLoading && foundCustomer && (
                      <UserCheck size={16} className="status-icon status-found" />
                    )}
                    {!customerLoading && isNewCustomer && (
                      <UserPlus size={16} className="status-icon status-new" />
                    )}
                  </span>
                )}
              </div>
            </div>
            {errors.customerPhone && <span id="staff-booking-customerPhone-error" className="form-error" role="alert">{errors.customerPhone}</span>}
          </div>
        </div>

        {/* Customer summary card for returning customers */}
        {!booking && foundCustomer && (
          <CustomerSummaryCard customer={foundCustomer} />
        )}

        {/* New customer indicator */}
        {!booking && !initialCustomer?.id && isNewCustomer && formData.customerPhone.replace(/\s/g, '').length >= 6 && (
          <div className="new-customer-badge">
            <UserPlus size={16} />
            <span>{t('bookings.newCustomer')}</span>
          </div>
        )}
      </div>

      <div className="form-section">
        <h4 className="form-section-title">{t('bookings.bookingDetails')}</h4>

        {/* Barber selection - only in manager view */}
        {isManagerView && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="staff-booking-barberId">{t('bookings.barber')}</label>
              {barbers.length > 0 ? (
                <select
                  name="barberId"
              id="staff-booking-barberId"
              aria-invalid={Boolean(errors.barberId)}
              aria-describedby={errors.barberId ? 'staff-booking-barberId-error' : undefined}
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
              {errors.barberId && <span id="staff-booking-barberId-error" className="form-error" role="alert">{errors.barberId}</span>}
            </div>
          </div>
        )}

        <div className="form-group">
          {offerLoading && <p role="status">{t('common.loading')}</p>}
          {offerFailure && formData.packageOfferId && <p className="form-error-banner" role="alert">{t('packages.errors.PACKAGE_UNAVAILABLE')}</p>}
          <PackagePicker offers={historicalOffer && historicalOffer.serviceIds.every(id => selectedBarber?.services?.includes(id)) ? [historicalOffer, ...offers.filter(item => item.id !== historicalOffer.id)] : offers} selected={formData.packageOfferId} services={calculatedServices} onChange={selectOffer} disabled={saving || offerLoading} />
          <label className="form-label">{t('bookings.services')}</label>
          {services.length > 0 ? (
            <>
              <div className={`services-select-grid ${errors.serviceIds ? 'error' : ''}`}>
                {services.filter(service => (service.status !== 'inactive' && (!selectedBarber || selectedBarber.services?.includes(service.id))) || booking?.serviceIds.includes(service.id)).map((service) => {
                  const isSelected = formData.serviceIds.includes(service.id);
                  return (
                    <label
                      key={service.id}
                      className={`service-checkbox-card ${isSelected ? 'selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        disabled={selectedOffer?.serviceIds.includes(service.id)}
                        checked={isSelected}
                        onChange={() => toggleService(service.id)}
                      />
                      <div className="service-checkbox-content">
                        <span className="service-checkbox-name">{service.name}</span>
                        <span className="service-checkbox-meta">
                          {service.duration} {t('common.min')} - {selectedOffer?.serviceIds.includes(service.id) ? t('packages.included') : `${service.price} ${t('common.currency')}`}
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
          {errors.serviceIds && <span className="form-error" role="alert">{errors.serviceIds}</span>}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="staff-booking-date">{t('bookings.date')}</label>
            <input
              type="date"
              name="date"
              id="staff-booking-date"
              aria-invalid={Boolean(errors.date)}
              aria-describedby={errors.date ? 'staff-booking-date-error' : undefined}
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
            {errors.date && !dateError && <span id="staff-booking-date-error" className="form-error" role="alert">{errors.date}</span>}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="staff-booking-time">{t('bookings.time')}</label>
            <select
              name="time"
              id="staff-booking-time"
              aria-invalid={Boolean(errors.time)}
              aria-describedby={errors.time ? 'staff-booking-time-error' : undefined}
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
            {errors.time && <span id="staff-booking-time-error" className="form-error" role="alert">{errors.time}</span>}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="staff-booking-notes">{t('bookings.notesLabel')}</label>
          <textarea
            maxLength={500}
            name="notes"
              id="staff-booking-notes"
            value={formData.notes}
            onChange={handleChange}
            className="form-input form-textarea"
            placeholder={t('bookings.notesPlaceholder')}
            rows={2}
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving || (Boolean(formData.packageOfferId) && offerLoading)}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || (Boolean(formData.packageOfferId) && offerLoading)}>
          {booking ? t('bookings.updateBooking') : t('bookings.createBooking')}
        </button>
      </div>
    </form>
  );
}

export default BookingForm;
