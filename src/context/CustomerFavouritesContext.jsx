import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useCustomerAuth } from './CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import { clearFavouriteIntent, favouriteKey, readFavouriteIntent } from '../utils/customerFavourites';
const defaults = { items: [], loading: false, busy: false, busyKey: '', error: '', feedback: '', reload: () => {}, toggle: () => {} };
const Context = createContext(defaults);
export function CustomerFavouritesProvider({ children }) {
  const { customer } = useCustomerAuth();
  const owner = customer?.id || '';
  const generation = useRef(0);
  const lock = useRef(false);
  const [state, setState] = useState({ ...defaults, owner: '' });
  const load = useCallback(async () => {
    if (!owner || lock.current) return;
    const version = ++generation.current;
    lock.current = true;
    setState(current => ({ ...current, owner, loading: true, error: '', feedback: '' }));
    try {
      const intent = readFavouriteIntent();
      const items = intent ? await customerAuthService.saveFavourite(intent.kind, intent.targetId) : await customerAuthService.favourites();
      if (version !== generation.current) return;
      if (intent) clearFavouriteIntent();
      setState(current => ({ ...current, owner, items, loading: false, error: '', feedback: intent ? 'saved' : '' }));
    } catch (failure) {
      if (version === generation.current) {
        if (failure.message === 'FAVOURITE_UNAVAILABLE') clearFavouriteIntent();
        setState(current => ({ ...current, owner, loading: false, error: failure.message || 'UNAVAILABLE' }));
      }
    } finally { if (version === generation.current) lock.current = false; }
  }, [owner]);
  useEffect(() => {
    generation.current++; lock.current = false;
    setState({ ...defaults, owner, loading: Boolean(owner) });
    if (owner) load();
    return () => { generation.current++; lock.current = false; };
  }, [owner, load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') load(); };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [load]);
  const toggle = async (kind, targetId) => {
    if (!owner || lock.current || state.loading || state.owner !== owner) return;
    lock.current = true;
    const version = ++generation.current;
    const selected = state.items.some(item => favouriteKey(item.kind, item.targetId) === favouriteKey(kind, targetId));
    setState(current => ({ ...current, busy: true, busyKey: favouriteKey(kind, targetId), error: '', feedback: '' }));
    try {
      const items = await customerAuthService[selected ? 'removeFavourite' : 'saveFavourite'](kind, targetId);
      if (version === generation.current) setState(current => ({ ...current, items, feedback: selected ? 'removed' : 'saved' }));
    } catch (failure) { if (version === generation.current) setState(current => ({ ...current, error: failure.message || 'UNAVAILABLE' })); }
    finally { if (version === generation.current) { lock.current = false; setState(current => ({ ...current, busy: false, busyKey: '' })); } }
  };
  const visible = state.owner === owner ? state : { ...defaults, loading: Boolean(owner) };
  return <Context.Provider value={{ ...visible, toggle, reload: load }}>{children}</Context.Provider>;
}
export const useCustomerFavourites = () => useContext(Context);
