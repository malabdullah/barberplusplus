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
  const pendingItems = detail?.pending_items || [];
  const pending = pendingItems[0] || null;
  const selected = detail?.selected_request;
  const review = null;
  const seed = useMemo(() => {
    if (!detail) return null;
    return !manager && detail.draft ? detail.draft : { availability: detail.barber.availability, time_offs: detail.barber.time_offs || [],
      vacations: detail.barber.vacations || [], max_booking_days: detail.barber.max_booking_days };
  }, [detail, manager]);
  useEffect(() => {
    if (!detail || !proposal || !manager || (detail.pending_items?.length && !detail.barber.manager_chair)) { setChecking(false); return; }
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
        base_revision: detail.barber.availability_revision, draft_token: detail.draft_token, proposal, note });
      if (result.blocked) { setConflicts(result.conflicts); setNotice('blocked'); return false; }
      setNotice(result.no_changes ? 'noChanges' : action === 'submit' ? 'submitted' : action === 'decline' ? 'declined' : 'approved');
      await onRefresh(); reload(); return true;
    } catch (failure) { setError(failure); return false; }
    finally { setBusy(false); }
  };
  return { detail, seed, review, selected, pending, pendingItems, error, loading, busy, conflicts, checking, notice, reload, decide };
}
