import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scissors } from 'lucide-react';
import LanguageSelector from '../UI/LanguageSelector';
import ThemeSelector from '../UI/ThemeSelector';

export default function LandingFooter() {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();

  const scrollToSection = (sectionId) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <footer className="landing-footer" role="contentinfo">
      <div className="footer-inner">
        <div className="footer-main">
          {/* Brand */}
          <div className="footer-brand">
            <Link to="/" className="footer-brand-logo" aria-label="Barber++ Home">
              <div className="footer-logo-icon" aria-hidden="true">
                <Scissors size={20} strokeWidth={1.5} />
              </div>
              <span className="footer-logo-name">Barber++</span>
            </Link>
            <p className="footer-tagline">
              {t('landing.footer.tagline')}
            </p>
          </div>

          {/* Product Links */}
          <div className="footer-column">
            <h4>{t('landing.footer.product')}</h4>
            <nav className="footer-links" aria-label="Product links">
              <button
                className="footer-link"
                onClick={() => scrollToSection('features')}
              >
                {t('landing.footer.features')}
              </button>
              <button
                className="footer-link"
                onClick={() => scrollToSection('how-it-works')}
              >
                {t('landing.footer.howItWorks')}
              </button>
              <button
                className="footer-link"
                onClick={() => scrollToSection('benefits')}
              >
                {t('landing.footer.benefits')}
              </button>
            </nav>
          </div>

          {/* Company Links */}
          <div className="footer-column">
            <h4>{t('landing.footer.company')}</h4>
            <nav className="footer-links" aria-label="Company links">
              <a href="#about" className="footer-link">
                {t('landing.footer.about')}
              </a>
              <a href="#contact" className="footer-link">
                {t('landing.footer.contact')}
              </a>
              <a href="#careers" className="footer-link">
                {t('landing.footer.careers')}
              </a>
            </nav>
          </div>

          {/* Legal Links */}
          <div className="footer-column">
            <h4>{t('landing.footer.legal')}</h4>
            <nav className="footer-links" aria-label="Legal links">
              <a href="#privacy" className="footer-link">
                {t('landing.footer.privacy')}
              </a>
              <a href="#terms" className="footer-link">
                {t('landing.footer.terms')}
              </a>
            </nav>
          </div>
        </div>

        {/* Footer Bottom */}
        <div className="footer-bottom">
          <p className="footer-copyright">
            © {currentYear} {t('landing.footer.copyright')}
          </p>
          <div className="footer-selectors">
            <LanguageSelector />
            <ThemeSelector />
          </div>
        </div>
      </div>
    </footer>
  );
}
