import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Plus, AlertTriangle, Check } from 'lucide-react';
import { getMaxAllowedDuration, getMaxExtension } from '../../utils/bookingConflicts';

export default function ExtendBookingSection({
  booking,
  services,
  barberData,
  existingBookings,
  onExtend,
}) {
  const { t } = useTranslation();
  const [isExtending, setIsExtending] = useState(false);
  const [error, setError] = useState(null);
  const [successService, setSuccessService] = useState(null);

  // Calculate current services duration from serviceIds (not booking.duration)
  const currentServicesDuration = useMemo(() => {
    if (!booking?.serviceIds || !services) return 0;
    return booking.serviceIds
      .map(id => services.find(s => s.id === id)?.duration || 0)
      .reduce((sum, d) => sum + d, 0);
  }, [booking?.serviceIds, services]);

  // Calculate max allowed total duration from booking start time
  const maxAllowedDuration = useMemo(() => {
    if (!booking || !barberData) return 0;
    return getMaxAllowedDuration({
      booking,
      existingBookings: existingBookings || [],
      barberData,
    });
  }, [booking, existingBookings, barberData]);

  // Calculate how much more time can be added
  const maxExtension = useMemo(() => {
    return Math.max(0, maxAllowedDuration - currentServicesDuration);
  }, [maxAllowedDuration, currentServicesDuration]);

  // Filter services that fit: newTotalDuration <= maxAllowedDuration
  const availableServices = useMemo(() => {
    if (!services || maxAllowedDuration <= 0) return [];
    return services.filter(service => {
      const newTotalDuration = currentServicesDuration + service.duration;
      return newTotalDuration <= maxAllowedDuration;
    });
  }, [services, currentServicesDuration, maxAllowedDuration]);

  // Don't show for completed/cancelled bookings
  if (['completed', 'cancelled', 'no-show'].includes(booking?.status)) {
    return null;
  }

  const handleExtend = async (serviceId) => {
    setIsExtending(true);
    setError(null);
    setSuccessService(null);

    try {
      await onExtend(booking.id, serviceId);
      const service = services.find(s => s.id === serviceId);
      setSuccessService(service?.name);
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessService(null), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsExtending(false);
    }
  };

  // No time available for extension
  if (maxExtension < 15) {
    return (
      <div className="extend-booking-section extend-disabled">
        <div className="extend-header">
          <Clock size={16} />
          <span>{t('bookings.extend.title')}</span>
        </div>
        <p className="extend-unavailable">{t('bookings.extend.noTimeAvailable')}</p>
      </div>
    );
  }

  // No services fit
  if (availableServices.length === 0) {
    return (
      <div className="extend-booking-section extend-disabled">
        <div className="extend-header">
          <Clock size={16} />
          <span>{t('bookings.extend.title')}</span>
        </div>
        <p className="extend-unavailable">{t('bookings.extend.noServicesAvailable')}</p>
        <p className="extend-max-hint">
          {t('bookings.extend.maxAvailable', { minutes: maxExtension })}
        </p>
      </div>
    );
  }

  return (
    <div className="extend-booking-section">
      <div className="extend-header">
        <Clock size={16} />
        <span>{t('bookings.extend.title')}</span>
      </div>

      <p className="extend-subtitle">{t('bookings.extend.selectService')}</p>

      <div className="extend-services-grid">
        {availableServices.map((service) => (
          <button
            key={service.id}
            className="extend-service-card"
            disabled={isExtending}
            onClick={() => handleExtend(service.id)}
          >
            <div className="extend-service-info">
              <span className="extend-service-name">{service.name}</span>
              <span className="extend-service-details">
                +{service.duration} {t('common.min')} | +{service.price} {t('common.currency')}
              </span>
            </div>
            <Plus size={16} className="extend-service-icon" />
          </button>
        ))}
      </div>

      {successService && (
        <div className="extend-success">
          <Check size={14} />
          {t('bookings.extend.success', { service: successService })}
        </div>
      )}

      {error && (
        <div className="extend-error">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <p className="extend-max-hint">
        {t('bookings.extend.maxAvailable', { minutes: maxExtension })}
      </p>
    </div>
  );
}
