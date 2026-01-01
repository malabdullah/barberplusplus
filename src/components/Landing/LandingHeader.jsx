import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scissors, Menu, X } from 'lucide-react';
import LanguageSelector from '../UI/LanguageSelector';
import ThemeSelector from '../UI/ThemeSelector';

export default function LandingHeader() {
  const { t } = useTranslation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (sectionId) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setIsMobileMenuOpen(false);
    }
  };

  return (
    <header className={`landing-header ${isScrolled ? 'scrolled' : ''}`}>
      <div className="landing-header-inner">
        {/* Logo */}
        <Link to="/" className="landing-logo" aria-label="Barber++ Home">
          <div className="landing-logo-icon">
            <Scissors size={24} strokeWidth={1.5} />
          </div>
          <div className="landing-logo-text">
            <span className="landing-logo-name">Barber++</span>
            <span className="landing-logo-tagline">{t('landing.header.tagline')}</span>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="landing-nav" aria-label="Main navigation">
          {/* Desktop Links */}
          <div className="landing-nav-links">
            <button
              className="landing-nav-link"
              onClick={() => scrollToSection('features')}
            >
              {t('landing.nav.features')}
            </button>
            <button
              className="landing-nav-link"
              onClick={() => scrollToSection('how-it-works')}
            >
              {t('landing.nav.howItWorks')}
            </button>
            <button
              className="landing-nav-link"
              onClick={() => scrollToSection('benefits')}
            >
              {t('landing.nav.benefits')}
            </button>
          </div>

          {/* Actions */}
          <div className="landing-nav-actions">
            <div className="landing-nav-selectors">
              <LanguageSelector />
              <ThemeSelector />
            </div>
            <Link to="/login" className="landing-btn landing-btn-ghost">
              {t('landing.header.signIn')}
            </Link>
            <Link to="/signup" className="landing-btn landing-btn-primary">
              {t('landing.header.getStarted')}
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="landing-mobile-menu-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? (
              <X size={24} strokeWidth={1.5} />
            ) : (
              <Menu size={24} strokeWidth={1.5} />
            )}
          </button>
        </nav>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="landing-mobile-menu">
          <div className="landing-mobile-menu-content">
            <button
              className="landing-mobile-link"
              onClick={() => scrollToSection('features')}
            >
              {t('landing.nav.features')}
            </button>
            <button
              className="landing-mobile-link"
              onClick={() => scrollToSection('how-it-works')}
            >
              {t('landing.nav.howItWorks')}
            </button>
            <button
              className="landing-mobile-link"
              onClick={() => scrollToSection('benefits')}
            >
              {t('landing.nav.benefits')}
            </button>
            <div className="landing-mobile-divider" />
            <Link
              to="/login"
              className="landing-mobile-link"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('landing.header.signIn')}
            </Link>
            <Link
              to="/signup"
              className="landing-btn landing-btn-primary landing-mobile-cta"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('landing.header.getStarted')}
            </Link>
            <div className="landing-mobile-selectors">
              <LanguageSelector />
              <ThemeSelector />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
