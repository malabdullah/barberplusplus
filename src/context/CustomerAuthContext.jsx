import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { customerAuthService } from '../services/customerAuth.service';
import { isTest } from '../lib/runtimeConfig';
const CustomerAuthContext = createContext(null);
export function CustomerAuthProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(isTest);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try { const profile = await customerAuthService.getProfile(); if (current === generation.current) setCustomer(profile); }
    catch { if (current === generation.current) setCustomer(null); }
    finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!isTest) return undefined;
    let timer;
    refresh();
    const subscription = customerAuthService.subscribe(event => {
      if (event === 'SIGNED_OUT') { generation.current++; setCustomer(null); setLoading(false); }
      else { clearTimeout(timer); timer = setTimeout(refresh, 0); }
    });
    return () => { generation.current++; clearTimeout(timer); subscription?.unsubscribe(); };
  }, [refresh]);
  const login = async data => { const profile = await customerAuthService.login(data); generation.current++; setCustomer(profile); setLoading(false); return profile; };
  const signup = async data => { const profile = await customerAuthService.signup(data); generation.current++; setCustomer(profile); setLoading(false); return profile; };
  const logout = async () => { await customerAuthService.logout(); generation.current++; setCustomer(null); };
  const updateProfile = async data => { const profile = await customerAuthService.updateProfile(data); generation.current++; setCustomer(profile); setLoading(false); return profile; };
  const resetPassword = async data => { await customerAuthService.resetPassword(data); generation.current++; setCustomer(null); };
  return <CustomerAuthContext.Provider value={{ customer, loading, login, signup, logout, updateProfile, resetPassword, refresh }}>{children}</CustomerAuthContext.Provider>;
}
export const useCustomerAuth = () => useContext(CustomerAuthContext);
