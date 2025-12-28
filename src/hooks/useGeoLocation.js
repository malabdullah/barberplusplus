import { useState, useEffect } from 'react';
import { GCC_COUNTRIES } from '../constants/countries';

const CACHE_KEY = 'user-country-code';
const DEFAULT_COUNTRY_CODE = '+965'; // Kuwait

/**
 * Hook to detect user's country via IP geolocation
 * Uses localStorage caching to avoid repeated API calls
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

    // Check localStorage cache first
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const country = GCC_COUNTRIES.find(c => c.country === cached);
      if (country) {
        setCountryCode(cached);
        setDialCode(country.code);
        setLoading(false);
        return;
      }
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

        const fetchedCountryCode = await res.text();
        localStorage.setItem(CACHE_KEY, fetchedCountryCode);

        const country = GCC_COUNTRIES.find(c => c.country === fetchedCountryCode);
        if (country) {
          setCountryCode(fetchedCountryCode);
          setDialCode(country.code);
        }
      } catch (error) {
        // Silently fail, keep default
        if (error.name !== 'AbortError') {
          console.debug('Geolocation fetch failed:', error.message);
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
