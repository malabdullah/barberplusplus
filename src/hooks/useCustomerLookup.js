import { useState, useEffect, useRef, useCallback } from 'react';
import { customersService } from '../services/customers.service';

const MIN_PHONE_LENGTH = 6;
const DEFAULT_DEBOUNCE_MS = 400;

/**
 * Hook to lookup customers by phone number with debouncing
 * @param {string} countryCode - Phone country code (e.g., '+965')
 * @param {string} phone - Phone number
 * @param {object} options - Options
 * @param {number} [options.debounceMs=400] - Debounce delay in milliseconds
 * @returns {{ customer: object|null, loading: boolean, error: string|null, isNewCustomer: boolean, reset: function }}
 */
export function useCustomerLookup(countryCode, phone, { debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);

  const timeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const lastSearchRef = useRef({ countryCode: '', phone: '' });

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
    if (!cleanPhone || cleanPhone.length < MIN_PHONE_LENGTH) {
      setCustomer(null);
      setIsNewCustomer(false);
      setLoading(false);
      setError(null);
      return;
    }

    // Skip if same as last search
    if (lastSearchRef.current.countryCode === countryCode && lastSearchRef.current.phone === cleanPhone) {
      return;
    }

    // Set loading immediately for visual feedback
    setLoading(true);
    setError(null);

    // Debounce the actual API call
    timeoutRef.current = setTimeout(async () => {
      try {
        // Create abort controller for this request
        abortControllerRef.current = new AbortController();

        // Store current search params
        lastSearchRef.current = { countryCode, phone: cleanPhone };

        const result = await customersService.searchByPhone(countryCode, cleanPhone);

        // Check if request was aborted
        if (abortControllerRef.current?.signal.aborted) {
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
        if (err.name === 'AbortError') {
          return;
        }
        setError(err.message || 'Failed to search customer');
        setCustomer(null);
        setIsNewCustomer(false);
      } finally {
        // Only update loading if not aborted
        if (!abortControllerRef.current?.signal.aborted) {
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
  }, [countryCode, phone, debounceMs]);

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
    lastSearchRef.current = { countryCode: '', phone: '' };
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
