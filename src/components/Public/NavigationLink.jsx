import React from 'react';
import { Link } from 'react-router-dom';
import { usePublicNavigation } from './PublicNavigationContext';

export default function NavigationLink({ children, onClick, ...props }) {
  const { busy } = usePublicNavigation();
  return <Link {...props} aria-disabled={busy || undefined} tabIndex={busy ? -1 : props.tabIndex} onClick={event => {
    if (busy) event.preventDefault();
    else onClick?.(event);
  }}>{children}</Link>;
}
