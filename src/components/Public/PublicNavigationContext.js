import { createContext, useContext, useEffect } from 'react';

export const NavigationContext = createContext({ busy: false, setBusy: () => {} });
export const usePublicNavigation = () => useContext(NavigationContext);

// Prevent leaving a page while its account or booking request is in flight.
export function usePublicNavigationBusy(busy) {
  const { setBusy } = usePublicNavigation();
  useEffect(() => {
    setBusy(busy);
    return () => setBusy(false);
  }, [busy, setBusy]);
}

