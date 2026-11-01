import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Monitor, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const THEMES = [
  { value: 'dark', labelKey: 'settings.themeDark', Icon: Moon },
  { value: 'light', labelKey: 'settings.themeLight', Icon: Sun },
  { value: 'system', labelKey: 'settings.themeSystem', Icon: Monitor },
];

export default function ThemeSelector({ onDropdownToggle, disabled = false }) {
  const { t } = useTranslation();
  const { theme, setTheme } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  // Get the current theme's icon
  const CurrentIcon = THEMES.find(th => th.value === theme)?.Icon || Moon;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    const closeOnEscape = event => { if (event.key === 'Escape') { setIsOpen(false); if (ref.current?.contains(document.activeElement)) ref.current.querySelector('button')?.focus(); } };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', handleClickOutside);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, []);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (onDropdownToggle) {
      onDropdownToggle(newState ? 'theme' : null);
    }
  };

  const handleSelect = (themeValue) => {
    setTheme(themeValue);
    setIsOpen(false);
    if (onDropdownToggle) {
      onDropdownToggle(null);
    }
  };

  // Close when another dropdown opens
  useEffect(() => {
    const handleCloseOthers = (event) => {
      if (event.detail !== 'theme') {
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
        type="button"
        disabled={disabled}
        aria-expanded={isOpen}
        onKeyDown={event => { if (event.key === 'Escape') setIsOpen(false); }}
        onClick={handleToggle}
        aria-label={t('preferences.selectTheme')}
        title={t('preferences.selectTheme')}
      >
        <CurrentIcon size={20} strokeWidth={1.5} />
      </button>

      {isOpen && !disabled && (
        <div className="topbar-dropdown preferences-dropdown animate-scale-in">
          <div className="topbar-dropdown-header">
            <span>{t('settings.theme')}</span>
          </div>
          <div className="topbar-dropdown-list">
            {THEMES.map((themeOption) => {
              const Icon = themeOption.Icon;
              return (
                <button
                  key={themeOption.value}
                  className={`topbar-dropdown-item preferences-option ${theme === themeOption.value ? 'active' : ''}`}
                  onClick={() => handleSelect(themeOption.value)}
                >
                  <div className="preferences-option-content">
                    <Icon size={16} strokeWidth={1.5} />
                    <span>{t(themeOption.labelKey)}</span>
                  </div>
                  {theme === themeOption.value && (
                    <Check size={16} strokeWidth={2} className="topbar-dropdown-check" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
