import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { accountToolsService } from '../services/accountTools.service';
export default function useAccountAccess() {
  const [session, setSession] = useState(undefined);
  const [identity, setIdentity] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let changed = false;
    const update = next => { if (active) { setSession(next || null); setIdentity(null); setError(''); } };
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { changed = true; update(next); });
    supabase.auth.getSession().then(({ data, error: failure }) => { if (!changed) update(failure ? null : data.session); }).catch(() => { if (!changed) update(null); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!session) return undefined;
    let active = true;
    accountToolsService.status(session.access_token).then(value => { if (active) { setIdentity(value); setError(''); } }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [session, attempt]);
  return { session, identity, error, loading: session === undefined || Boolean(session && !identity && !error), retry: () => setAttempt(value => value + 1) };
}
