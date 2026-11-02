import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { bookingsService } from '../services/bookings.service';

// Resolve the ID through already-authorized booking data, never a URL snapshot.
export function useNotificationBooking(bookings, onSelect, setCurrentWeek, setSelectedDay) {
  const [params, setParams] = useSearchParams();
  const id = params.get('booking');
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    setUnavailable(false);
    if (id) bookingsService.getById(id).catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    if (!id) return;
    const booking = bookings.find(item => item.id === id);
    if (!booking) return;
    const date = new Date(`${booking.date}T12:00:00`);
    setCurrentWeek(date);
    setSelectedDay?.(date);
    onSelect(booking);
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('booking');
      return next;
    }, { replace: true });
  }, [id, bookings, onSelect, setCurrentWeek, setSelectedDay, setParams]);
  return unavailable;
}
