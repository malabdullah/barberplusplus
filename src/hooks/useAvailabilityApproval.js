import { useCallback, useEffect, useMemo, useState } from 'react';
import { availabilityService } from '../services/availability.service';

export function useAvailabilityApproval({ barberId, requestId, manager, proposal, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [checking, setChecking] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState(null);
  useEffect(() => { setNotice(null); }, [barberId, requestId]);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    let current = true;
    setLoading(true); setDetail(null); setError(null); setConflicts([]);
    if (!barberId) { setLoading(false); return; }
    availabilityService.call('get', { barber_id: barberId, request_id: requestId || undefined }).then(result => {
      if (current) setDetail(result);
    }).catch(failure => { if (current) setError(failure); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [barberId, requestId, refresh]);
  const pending = detail?.requests.find(item => item.status === 'pending');
  const selected = requestId ? (detail?.selected_request || detail?.requests.find(item => item.id === requestId)) : pending;
  const review = selected?.status === 'pending' ? selected : null;
  const seed = useMemo(() => {
    if (!detail) return null;
    const draft = (manager ? review : pending)?.proposal;
    return draft || { availability: detail.barber.availability, time_offs: detail.barber.time_offs || [],
      vacations: detail.barber.vacations || [], max_booking_days: detail.barber.max_booking_days };
  }, [detail, manager, review, pending]);
  useEffect(() => {
    if (!detail || !proposal || !manager) return;
    let current = true;
    setChecking(true);
    const timer = setTimeout(() => {
      availabilityService.call('preview', { barber_id: barberId, request_id: review?.id, proposal }).then(result => {
        if (current) { setConflicts(result.conflicts || []); setError(null); }
      }).catch(failure => { if (current) setError(failure); })
        .finally(() => { if (current) setChecking(false); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [detail, barberId, proposal, manager, review]);
  const decide = async (action, note = '') => {
    if (!detail || busy) return false;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await availabilityService.call(action, { barber_id: barberId, request_id: review?.id,
        base_revision: detail.barber.availability_revision, proposal, note });
      if (result.blocked) { setConflicts(result.conflicts); setNotice('blocked'); return false; }
      setNotice(action === 'submit' ? 'submitted' : action === 'decline' ? 'declined' : 'approved');
      await onRefresh(); reload(); return true;
    } catch (failure) { setError(failure); return false; }
    finally { setBusy(false); }
  };
  return { detail, seed, review, selected, pending, error, loading, busy, conflicts, checking, notice, reload, decide };
}
