import { useState, useEffect, useRef, useCallback } from 'react';
import { validatePhoneNumber } from '../utils/validation';
import { customersService } from '../services/customers.service';

const DEFAULT_DEBOUNCE_MS = 400;

/**
 * Hook to lookup customers by phone number with debouncing
 * @param {string} countryCode - Phone country code (e.g., '+965')
 * @param {string} phone - Phone number
 * @param {object} options - Options
 * @param {number} [options.debounceMs=400] - Debounce delay in milliseconds
 * @returns {{ customer: object|null, loading: boolean, error: string|null, isNewCustomer: boolean, reset: function }}
 */
export function useCustomerLookup(countryCode, phone, { branchId, debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);

  const timeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const lastSearchRef = useRef({ countryCode: '', phone: '', branchId: null });

  useEffect(() => {
    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clean phone input
    const cleanPhone = phone?.replace(/\s/g, '') || '';

    // Don't search if phone is too short
    if (!branchId || !cleanPhone || !validatePhoneNumber(cleanPhone, countryCode).valid) {
      setCustomer(null);
      setIsNewCustomer(false);
      setLoading(false);
      setError(null);
      return;
    }

    // Skip if same as last search
    if (lastSearchRef.current.countryCode === countryCode && lastSearchRef.current.phone === cleanPhone && lastSearchRef.current.branchId === branchId) {
      return;
    }

    setCustomer(null);
    setIsNewCustomer(false);
    // Set loading immediately for visual feedback
    setLoading(true);
    setError(null);

    // Debounce the actual API call
    const controller = new AbortController();
    abortControllerRef.current = controller;
    timeoutRef.current = setTimeout(async () => {
      try {
        // Store current search params
        lastSearchRef.current = { countryCode, phone: cleanPhone, branchId };

        const result = await customersService.searchByPhone(countryCode, cleanPhone, branchId);

        // Check if request was aborted
        if (controller.signal.aborted) {
          return;
        }

        if (result) {
          setCustomer(result);
          setIsNewCustomer(false);
        } else {
          setCustomer(null);
          setIsNewCustomer(true);
        }
      } catch (err) {
        // Ignore abort errors
        if (controller.signal.aborted || err.name === 'AbortError') {
          return;
        }
        setError(err.message || 'Failed to search customer');
        setCustomer(null);
        setIsNewCustomer(false);
      } finally {
        // Only update loading if not aborted
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, debounceMs);

    // Cleanup function
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [countryCode, phone, branchId, debounceMs]);

  // Reset function for external use
  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setCustomer(null);
    setIsNewCustomer(false);
    setLoading(false);
    setError(null);
    lastSearchRef.current = { countryCode: '', phone: '', branchId: null };
  }, []);

  return {
    customer,
    loading,
    error,
    isNewCustomer,
    reset,
  };
}

export default useCustomerLookup;
