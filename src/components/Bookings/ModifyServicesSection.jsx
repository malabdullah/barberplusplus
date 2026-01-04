import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2, Check, AlertTriangle, Plus, Minus } from 'lucide-react';
import { getMaxAllowedDuration } from '../../utils/bookingConflicts';

/**
 * Convert serviceIds array to counts object
 * e.g., ['a', 'b', 'a'] -> { a: 2, b: 1 }
 */
function getCountsFromIds(ids) {
  const counts = {};
  (ids || []).forEach(id => {
    counts[id] = (counts[id] || 0) + 1;
  });
  return counts;
}

/**
 * Convert counts object back to serviceIds array
 * e.g., { a: 2, b: 1 } -> ['a', 'a', 'b']
 */
function getIdsFromCounts(counts) {
  const ids = [];
  Object.entries(counts).forEach(([id, count]) => {
    for (let i = 0; i < count; i++) {
      ids.push(id);
    }
  });
  return ids;
}

/**
 * Compare two count objects for equality
 */
function countsEqual(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  // Filter out zero counts
  const nonZeroA = keysA.filter(k => a[k] > 0);
  const nonZeroB = keysB.filter(k => b[k] > 0);

  if (nonZeroA.length !== nonZeroB.length) return false;

  return nonZeroA.every(key => a[key] === b[key]);
}

export default function ModifyServicesSection({
  booking,
  services,
  barberData,
  existingBookings,
  onSave,
}) {
  const { t } = useTranslation();

  // Count-based state for proper duplicate handling
  const [selectedCounts, setSelectedCounts] = useState(() =>
    getCountsFromIds(booking?.serviceIds)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Sync selectedCounts when booking.serviceIds changes
  useEffect(() => {
    setSelectedCounts(getCountsFromIds(booking?.serviceIds));
  }, [booking?.serviceIds]);

  // Original counts for comparison
  const originalCounts = useMemo(() =>
    getCountsFromIds(booking?.serviceIds),
    [booking?.serviceIds]
  );

  // Calculate max allowed total duration from booking start time
  const maxAllowedDuration = useMemo(() => {
    if (!booking || !barberData) return 0;
    return getMaxAllowedDuration({
      booking,
      existingBookings: existingBookings || [],
      barberData,
    });
  }, [booking, existingBookings, barberData]);

  // Current booking's totals (from original serviceIds)
  const currentDuration = useMemo(() => {
    if (!booking?.serviceIds || !services) return 0;
    return booking.serviceIds
      .map(id => services.find(s => s.id === id)?.duration || 0)
      .reduce((sum, d) => sum + d, 0);
  }, [booking?.serviceIds, services]);

  const currentPrice = useMemo(() => {
    if (!booking?.serviceIds || !services) return 0;
    return booking.serviceIds
      .map(id => services.find(s => s.id === id)?.price || 0)
      .reduce((sum, p) => sum + p, 0);
  }, [booking?.serviceIds, services]);

  // New selected totals (from counts)
  const newDuration = useMemo(() => {
    return Object.entries(selectedCounts).reduce((sum, [id, count]) => {
      const service = services?.find(s => s.id === id);
      return sum + (service?.duration || 0) * count;
    }, 0);
  }, [selectedCounts, services]);

  const newPrice = useMemo(() => {
    return Object.entries(selectedCounts).reduce((sum, [id, count]) => {
      const service = services?.find(s => s.id === id);
      return sum + (service?.price || 0) * count;
    }, 0);
  }, [selectedCounts, services]);

  // Total count of services
  const totalServiceCount = useMemo(() => {
    return Object.values(selectedCounts).reduce((sum, count) => sum + count, 0);
  }, [selectedCounts]);

  // Validation
  const hasChanges = !countsEqual(selectedCounts, originalCounts);
  const isMinValid = totalServiceCount >= 1;
  const isDurationValid = newDuration <= maxAllowedDuration;
  const isValid = isMinValid && isDurationValid;
  const durationDiff = newDuration - currentDuration;

  // Don't show for completed/cancelled bookings
  if (['completed', 'cancelled', 'no-show'].includes(booking?.status)) {
    return null;
  }

  const increment = (serviceId) => {
    const service = services?.find(s => s.id === serviceId);
    if (!service) return;

    // Check if we can add more (duration validation)
    if (newDuration + service.duration > maxAllowedDuration) {
      return;
    }

    setSelectedCounts(prev => ({
      ...prev,
      [serviceId]: (prev[serviceId] || 0) + 1,
    }));
    setError(null);
    setSuccess(false);
  };

  const decrement = (serviceId) => {
    setSelectedCounts(prev => {
      const currentCount = prev[serviceId] || 0;
      if (currentCount <= 0) return prev;

      const newCounts = { ...prev };
      if (currentCount === 1) {
        delete newCounts[serviceId];
      } else {
        newCounts[serviceId] = currentCount - 1;
      }
      return newCounts;
    });
    setError(null);
    setSuccess(false);
  };

  const canAdd = (serviceId) => {
    const service = services?.find(s => s.id === serviceId);
    if (!service) return false;
    return newDuration + service.duration <= maxAllowedDuration;
  };

  const handleSave = async () => {
    if (!isValid || !hasChanges) return;

    setIsSaving(true);
    setError(null);

    try {
      const newServiceIds = getIdsFromCounts(selectedCounts);
      await onSave(booking.id, newServiceIds);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setSelectedCounts(getCountsFromIds(booking?.serviceIds));
    setError(null);
    setSuccess(false);
  };

  return (
    <div className="modify-services-section">
      {/* Header */}
      <div className="modify-services-header">
        <Settings2 size={16} />
        <span>{t('bookings.modifyServices.title')}</span>
      </div>

      <p className="modify-services-subtitle">
        {t('bookings.modifyServices.subtitle')}
      </p>

      {/* Services Grid */}
      <div className="modify-services-grid">
        {services?.map((service) => {
          const count = selectedCounts[service.id] || 0;
          const originalCount = originalCounts[service.id] || 0;
          const canIncrement = canAdd(service.id);

          return (
            <div
              key={service.id}
              className={`modify-service-card ${count > 0 ? 'selected' : ''} ${originalCount > 0 && count === 0 ? 'removed' : ''}`}
            >
              <div className="modify-service-info">
                <span className="modify-service-name">{service.name}</span>
                <span className="modify-service-details">
                  {service.duration} {t('common.min')} | {service.price} {t('common.currency')}
                </span>
              </div>
              <div className="modify-service-controls">
                <button
                  className="qty-btn decrement"
                  onClick={() => decrement(service.id)}
                  disabled={isSaving || count === 0}
                  aria-label={t('bookings.modifyServices.remove')}
                >
                  <Minus size={14} />
                </button>
                <span className="qty-value">{count}</span>
                <button
                  className="qty-btn increment"
                  onClick={() => increment(service.id)}
                  disabled={isSaving || !canIncrement}
                  aria-label={t('bookings.modifyServices.add')}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary - only show when changes detected */}
      {hasChanges && (
        <div className="modify-services-summary">
          <div className="summary-row current">
            <span className="summary-label">{t('bookings.modifyServices.currentTotal')}</span>
            <span className="summary-value">
              {currentDuration} {t('common.min')} | {currentPrice} {t('common.currency')}
            </span>
          </div>
          <div className="summary-row new">
            <span className="summary-label">{t('bookings.modifyServices.newTotal')}</span>
            <span className="summary-value">
              {newDuration} {t('common.min')} | {newPrice} {t('common.currency')}
              <span className={`duration-diff ${durationDiff > 0 ? 'increase' : durationDiff < 0 ? 'decrease' : ''}`}>
                {durationDiff !== 0 && (
                  <> ({durationDiff > 0 ? '+' : ''}{durationDiff} {t('common.min')})</>
                )}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Validation Messages */}
      {!isMinValid && (
        <div className="modify-services-error">
          <AlertTriangle size={14} />
          {t('bookings.modifyServices.minOneRequired')}
        </div>
      )}

      {hasChanges && !isDurationValid && (
        <div className="modify-services-error">
          <AlertTriangle size={14} />
          {t('bookings.modifyServices.durationExceeds')}
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="modify-services-success">
          <Check size={14} />
          {t('bookings.modifyServices.success')}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="modify-services-error">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Actions - only show when changes detected */}
      {hasChanges && (
        <div className="modify-services-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleReset}
            disabled={isSaving}
          >
            {t('bookings.modifyServices.cancel')}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={!isValid || isSaving}
          >
            {isSaving ? t('common.saving') : t('bookings.modifyServices.saveChanges')}
          </button>
        </div>
      )}

      {/* Max Duration Hint */}
      <p className="modify-services-hint">
        {t('bookings.modifyServices.maxDuration', { minutes: maxAllowedDuration })}
      </p>
    </div>
  );
}
