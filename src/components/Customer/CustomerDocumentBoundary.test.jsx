import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import CustomerDocumentBoundary from './CustomerDocumentBoundary';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); localStorage.clear(); sessionStorage.clear(); });
function mount(documentPath, destination) {
  window.history.replaceState(null, '', documentPath);
  const replace = vi.fn();
  render(<MemoryRouter initialEntries={[documentPath]}><Link to={destination}>Navigate</Link><CustomerDocumentBoundary replace={replace}><p>Current document</p></CustomerDocumentBoundary></MemoryRouter>);
  fireEvent.click(screen.getByRole('link'));
  return replace;
}
it.each([
  ['/book', '/customer/delete-account'],
  ['/customer/delete-account', '/customer/account?view=upcoming#profile'],
  ['/customer/auth-callback', '/customer/delete-account'],
  ['/customer/auth-callback', '/'],
])('reloads from %s to %s before rendering the destination', (from, to) => {
  localStorage.setItem('session', 'preserved'); sessionStorage.setItem('draft-and-receipt', 'preserved');
  const replace = mount(from, to);
  expect(replace).toHaveBeenCalledExactlyOnceWith(to);
  expect(screen.queryByText('Current document')).not.toBeInTheDocument();
  expect(localStorage.getItem('session')).toBe('preserved');
  expect(sessionStorage.getItem('draft-and-receipt')).toBe('preserved');
});
it.each([['/book', '/customer/account'], ['/dashboard', '/dashboard/settings'], ['/customer/delete-account', '/customer/delete-account?resume=1']])('keeps normal navigation within the same document policy', (from, to) => {
  expect(mount(from, to)).not.toHaveBeenCalled();
  expect(screen.getByText('Current document')).toBeVisible();
});
