import React from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function ThemeSelector({ onDropdownToggle, disabled = false }) {
  const { t } = useTranslation();
  const { theme, setTheme } = useApp();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const Icon = nextTheme === 'light' ? Sun : Moon;
  const label = t(nextTheme === 'light' ? 'preferences.switchToLight' : 'preferences.switchToDark');

  return <div className="preferences-selector">
    <button className="topbar-icon-btn" type="button" disabled={disabled} aria-label={label} title={label} onClick={() => {
      setTheme(nextTheme);
      onDropdownToggle?.(null);
    }}><Icon size={20} strokeWidth={1.5} aria-hidden="true" /></button>
  </div>;
}
