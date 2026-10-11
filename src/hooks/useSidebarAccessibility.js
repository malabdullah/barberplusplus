import { useEffect, useRef, useState } from 'react';

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function useSidebarAccessibility(isOpen, onClose, label) {
  const sidebarRef = useRef(null);
  const closeRef = useRef(onClose);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1024px)').matches);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1024px)');
    const update = () => { setMobile(query.matches); if (!query.matches) closeRef.current?.(); };
    query.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => { query.removeEventListener('change', update); window.removeEventListener('resize', update); };
  }, []);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    sidebar.toggleAttribute('inert', mobile && !isOpen);
    sidebar.setAttribute('aria-label', label);
    if (mobile && !isOpen) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');
    sidebar.setAttribute('role', mobile && isOpen ? 'dialog' : 'complementary');
    if (mobile && isOpen) sidebar.setAttribute('aria-modal', 'true');
    else sidebar.removeAttribute('aria-modal');
    if (!mobile || !isOpen) return;
    // Safari does not necessarily focus a button when it is clicked. Return
    // keyboard focus to the actual menu trigger, even in that browser.
    const previousFocus = sidebar.closest('.layout')?.querySelector('.topbar-menu-btn') || document.activeElement;
    const content = sidebar.closest('.layout')?.querySelector('.layout-main');
    const contentWasInert = content?.hasAttribute('inert');
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    content?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    const controls = () => [...sidebar.querySelectorAll(focusableSelector)].filter(element => element.getClientRects().length);
    controls()[0]?.focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); return; }
      if (event.key !== 'Tab') return;
      const elements = controls(); const first = elements[0]; const last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (!contentWasInert) content?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus();
    };
  }, [mobile, isOpen, label]);
  return sidebarRef;
}
