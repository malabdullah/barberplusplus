import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

export default function LanguageSelector({ onDropdownToggle }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (onDropdownToggle) {
      onDropdownToggle(newState ? 'language' : null);
    }
  };

  const handleSelect = (langCode) => {
    setLanguage(langCode);
    setIsOpen(false);
    if (onDropdownToggle) {
      onDropdownToggle(null);
    }
  };

  // Close when another dropdown opens
  useEffect(() => {
    const handleCloseOthers = (event) => {
      if (event.detail !== 'language') {
        setIsOpen(false);
      }
    };
    window.addEventListener('closeOtherDropdowns', handleCloseOthers);
    return () => window.removeEventListener('closeOtherDropdowns', handleCloseOthers);
  }, []);

  return (
    <div className="preferences-selector" ref={ref}>
      <button
        className="topbar-icon-btn"
        onClick={handleToggle}
        aria-label={t('preferences.selectLanguage')}
        title={t('preferences.selectLanguage')}
      >
        <Globe size={20} strokeWidth={1.5} />
      </button>

      {isOpen && (
        <div className="topbar-dropdown preferences-dropdown animate-scale-in">
          <div className="topbar-dropdown-header">
            <span>{t('settings.language')}</span>
          </div>
          <div className="topbar-dropdown-list">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                className={`topbar-dropdown-item preferences-option ${language === lang.code ? 'active' : ''}`}
                onClick={() => handleSelect(lang.code)}
              >
                <span>{lang.label}</span>
                {language === lang.code && (
                  <Check size={16} strokeWidth={2} className="topbar-dropdown-check" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
