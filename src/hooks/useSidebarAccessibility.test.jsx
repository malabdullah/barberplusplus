import React, { useState } from 'react';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useSidebarAccessibility from './useSidebarAccessibility';

function Fixture() {
  const [open, setOpen] = useState(false);
  const ref = useSidebarAccessibility(open, () => setOpen(false), 'Navigation');
  return <div className="layout">
    <aside ref={ref}><button onClick={() => setOpen(false)}>Close</button><a href="#">Last link</a></aside>
    <div className="layout-main"><button className="topbar-menu-btn" onClick={() => setOpen(true)}>Open menu</button></div>
  </div>;
}
describe('mobile sidebar accessibility', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}]);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it('removes hidden controls from navigation and restores focus after Escape', () => {
    render(<Fixture />);
    expect(document.querySelector('aside')).toHaveAttribute('inert');
    const open = screen.getByText('Open menu'); open.focus(); fireEvent.click(open);
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toHaveAttribute('aria-modal', 'true');
    expect(document.querySelector('.layout-main')).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByText('Close')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('aside')).toHaveAttribute('inert');
    expect(document.querySelector('.layout-main')).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe(''); expect(open).toHaveFocus();
  });
  it('wraps Tab and Shift-Tab and restores scrolling on unmount', () => {
    const view = render(<Fixture />); fireEvent.click(screen.getByText('Open menu'));
    screen.getByText('Last link').focus(); fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByText('Close')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(screen.getByText('Last link')).toHaveFocus();
    view.unmount(); expect(document.body.style.overflow).toBe('');
  });
  it('returns to the trigger when Safari click did not focus it', () => {
    render(<Fixture />); fireEvent.click(screen.getByText('Open menu'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Open menu')).toHaveFocus();
  });
});
