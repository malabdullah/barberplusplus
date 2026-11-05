import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { customerAuthService } from '../services/customerAuth.service';
import { customerFeaturesEnabled } from '../lib/runtimeConfig';
const CustomerAuthContext = createContext(null);
export function CustomerAuthProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(customerFeaturesEnabled);
  const generation = useRef(0);
  const identity = useRef(null);
  const { pathname } = useLocation();
  const personalArea = pathname === '/book' || pathname.startsWith('/customer/');
  const previousArea = useRef(personalArea);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try { setError(false); const profile = await customerAuthService.getProfile(); if (current === generation.current) setCustomer(profile); }
    catch { if (current === generation.current) { setCustomer(null); setError(true); } }
    finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!customerFeaturesEnabled) return undefined;
    let timer;
    refresh();
    const subscription = customerAuthService.subscribe((event, session) => {
      const next = session?.user?.id || null;
      if (identity.current !== next) { generation.current++; setCustomer(null); setLoading(Boolean(next)); identity.current = next; }
      if (event === 'SIGNED_OUT') { generation.current++; setCustomer(null); setError(false); setLoading(false); }
      else { clearTimeout(timer); timer = setTimeout(refresh, 0); }
    });
    return () => { generation.current++; clearTimeout(timer); subscription?.unsubscribe(); };
  }, [refresh]);
  // Work edits (including creating My Chair) can change personal contact data
  // and which barber IDs belong to this account without an Auth event.
  useEffect(() => {
    if (customerFeaturesEnabled && personalArea && !previousArea.current) {
      setLoading(true);
      void refresh();
    }
    previousArea.current = personalArea;
  }, [personalArea, refresh]);
  const login = async data => { const profile = await customerAuthService.login(data); generation.current++; setCustomer(profile); setLoading(false); return profile; };
  const logout = async () => { await customerAuthService.logout(); generation.current++; setCustomer(null); };
  const updateProfile = async data => { const profile = await customerAuthService.updateProfile(data); generation.current++; setCustomer(profile); setLoading(false); return profile; };
  const resetPassword = async data => { await customerAuthService.resetPassword(data); generation.current++; setCustomer(null); };
  return <CustomerAuthContext.Provider value={{ customer, loading, error, login, logout, updateProfile, resetPassword, refresh }}>{children}</CustomerAuthContext.Provider>;
}
export const useCustomerAuth = () => useContext(CustomerAuthContext);
