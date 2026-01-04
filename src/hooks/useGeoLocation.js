import { useState, useEffect } from 'react';
import { GCC_COUNTRIES } from '../constants/countries';

const CACHE_KEY = 'user-country-code';
const CACHE_TIMESTAMP_KEY = 'user-country-code-ts';
const RATE_LIMIT_KEY = 'geo-rate-limit';
const DEFAULT_COUNTRY_CODE = '+965'; // Kuwait
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 3;

/**
 * SECURITY: Rate limiter for geolocation API calls
 * Prevents excessive requests to third-party API
 */
const checkRateLimit = () => {
  try {
    const stored = localStorage.getItem(RATE_LIMIT_KEY);
    if (!stored) return true;

    const { count, windowStart } = JSON.parse(stored);
    const now = Date.now();

    // Reset window if expired
    if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
      localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify({ count: 1, windowStart: now }));
      return true;
    }

    // Check if under limit
    if (count < MAX_REQUESTS_PER_WINDOW) {
      localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify({ count: count + 1, windowStart }));
      return true;
    }

    return false;
  } catch {
    return true; // Allow on error
  }
};

/**
 * SECURITY: Check if cache is still valid
 */
const isCacheValid = () => {
  try {
    const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!timestamp) return false;
    return Date.now() - parseInt(timestamp, 10) < CACHE_TTL_MS;
  } catch {
    return false;
  }
};

/**
 * Hook to detect user's country via IP geolocation
 * Uses localStorage caching to avoid repeated API calls
 * SECURITY: Implements rate limiting and cache TTL
 * @param {string} [initialCountryCode] - Optional initial country code (from existing data)
 * @returns {{ countryCode: string, dialCode: string, loading: boolean }}
 */
export function useGeoLocation(initialCountryCode) {
  const [countryCode, setCountryCode] = useState(initialCountryCode || null);
  const [dialCode, setDialCode] = useState(DEFAULT_COUNTRY_CODE);
  const [loading, setLoading] = useState(!initialCountryCode);

  useEffect(() => {
    // If initial country code provided, use it
    if (initialCountryCode) {
      const country = GCC_COUNTRIES.find(c => c.code === initialCountryCode);
      if (country) {
        setDialCode(initialCountryCode);
        setCountryCode(country.country);
      }
      setLoading(false);
      return;
    }

    // Check localStorage cache first (with TTL validation)
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached && isCacheValid()) {
      const country = GCC_COUNTRIES.find(c => c.country === cached);
      if (country) {
        setCountryCode(cached);
        setDialCode(country.code);
        setLoading(false);
        return;
      }
    }

    // SECURITY: Check rate limit before making API call
    if (!checkRateLimit()) {
      // Rate limited - use default and don't make API call
      setLoading(false);
      return;
    }

    // Fetch via secure HTTPS endpoint
    let cancelled = false;

    const fetchLocation = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const res = await fetch('https://ipapi.co/country_code/', {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (cancelled) return;

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const fetchedCountryCode = await res.text();

        // Validate response (should be 2-letter country code)
        if (!/^[A-Z]{2}$/.test(fetchedCountryCode.trim())) {
          throw new Error('Invalid country code format');
        }

        // Store with timestamp for TTL
        localStorage.setItem(CACHE_KEY, fetchedCountryCode.trim());
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());

        const country = GCC_COUNTRIES.find(c => c.country === fetchedCountryCode.trim());
        if (country) {
          setCountryCode(fetchedCountryCode.trim());
          setDialCode(country.code);
        }
      } catch (error) {
        // Silently fail, keep default
        if (error.name !== 'AbortError') {
          // Don't log in production
          if (import.meta.env.DEV) {
            console.debug('Geolocation fetch failed:', error.message);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchLocation();

    return () => {
      cancelled = true;
    };
  }, [initialCountryCode]);

  return { countryCode, dialCode, loading };
}

export default useGeoLocation;
