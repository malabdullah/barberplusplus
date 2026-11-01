import React, { useEffect, useRef } from 'react';
import HeroSection from '../components/Landing/HeroSection';
import FeaturesSection from '../components/Landing/FeaturesSection';
import HowItWorksSection from '../components/Landing/HowItWorksSection';
import BenefitsSection from '../components/Landing/BenefitsSection';
import CTASection from '../components/Landing/CTASection';
import { Scissors } from 'lucide-react';
import './Landing.css';

export default function Landing() {
  const observerRef = useRef(null);

  // Scroll-based animations using Intersection Observer
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-visible');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );

    const elements = document.querySelectorAll('.animate-on-scroll');
    elements.forEach((el) => observerRef.current.observe(el));

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div className="landing-page">
      {/* Background Elements */}
      <div className="landing-bg">
        <div className="landing-bg-gradient" />
        <div className="landing-bg-pattern" />
        <div className="landing-bg-glow landing-bg-glow-1" />
        <div className="landing-bg-glow landing-bg-glow-2" />
      </div>

      {/* Floating Scissors */}
      <div className="landing-float landing-float-1" aria-hidden="true">
        <Scissors size={48} strokeWidth={1} />
      </div>
      <div className="landing-float landing-float-2" aria-hidden="true">
        <Scissors size={32} strokeWidth={1} />
      </div>
      <div className="landing-float landing-float-3" aria-hidden="true">
        <Scissors size={24} strokeWidth={1} />
      </div>
      <div className="landing-float landing-float-4" aria-hidden="true">
        <Scissors size={36} strokeWidth={1} />
      </div>

      {/* Main Content */}
      <main id="main-content">
        <HeroSection />
        <div id="for-shops">
        <FeaturesSection />
        <HowItWorksSection />
        <BenefitsSection />
        <CTASection />
        </div>
      </main>

    </div>
  );
}
