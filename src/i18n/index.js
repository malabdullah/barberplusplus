import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ar from './locales/ar.json';
import { shopTerminology } from '../utils/customerTerminology';

i18n.use(shopTerminology).use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: localStorage.getItem('barber-language') || 'en',
  fallbackLng: 'en',
  postProcess: ['shopTerminology'],
  interpolation: {
    escapeValue: false, // React already handles XSS
  },
});

export default i18n;
