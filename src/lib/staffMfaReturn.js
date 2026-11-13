import { customerReturnTo } from '../utils/customerBookingDraft';

export function staffMfaReturn(value, customerDestination = '/customer/account') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/customer/account';
  const url = new URL(value, 'https://barber.invalid');
  if (url.origin !== 'https://barber.invalid' || url.pathname === '/mfa-setup') return '/customer/account';
  if (url.pathname.includes('callback') || ['/customer/sign-in', '/customer/sign-up'].includes(url.pathname)) {
    return url.searchParams.get('next') === 'book' || customerDestination === '/book' ? '/book' : '/customer/account';
  }
  if (url.pathname === '/customer/verify-email' && url.searchParams.get('purpose') === 'recovery') return '/customer/reset-password';
  return url.pathname + url.search;
}

export function redirectStaffMfa(returnTo = window.location.pathname + window.location.search) {
  window.location.assign('/mfa-setup?returnTo=' + encodeURIComponent(staffMfaReturn(returnTo, customerReturnTo(window.location))));
}
