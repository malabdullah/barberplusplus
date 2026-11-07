import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { bookingServices } from '../utils/bookingServices';
import { bookingsService } from '../services/bookings.service';

// Always resolve the ID through the current user's RLS, including after a
// reassignment. Cached calendar rows may still belong to a previous assignment.
export function useNotificationBooking(services, onSelect, setCurrentWeek, setSelectedDay) {
  const [params, setParams] = useSearchParams();
  const id = params.get('booking');
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    setUnavailable(false);
    if (!id) return;
    bookingsService.getById(id).then(booking => {
      if (!active) return;
      if (!booking) { setUnavailable(true); return; }
      const date = new Date(`${booking.date}T12:00:00`);
      setCurrentWeek(date);
      setSelectedDay?.(date);
      onSelect({ ...booking, serviceName: bookingServices(booking, services).map(service => service.name).filter(Boolean).join(', ') });
      setParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete('booking');
        return next;
      }, { replace: true });
    }).catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, [id, services, onSelect, setCurrentWeek, setSelectedDay, setParams]);
  return unavailable;
}
