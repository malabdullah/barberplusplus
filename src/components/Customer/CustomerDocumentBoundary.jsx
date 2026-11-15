import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const policy = path => path === '/customer/delete-account' ? 'popup'
  : path === '/customer/auth-callback' ? 'callback' : 'strict';
const replaceDocument = target => window.location.replace(target);

// COOP belongs to the loaded document, not React Router's current route. Reload
// when crossing a policy boundary, including exits through the public menu or
// programmatic redirects. Browser storage/receipts and ordinary SPA routes stay.
export default function CustomerDocumentBoundary({ children, replace = replaceDocument }) {
  const location = useLocation();
  const documentPolicy = useRef(policy(window.location.pathname));
  const crossing = policy(location.pathname) !== documentPolicy.current;
  useEffect(() => {
    if (crossing) replace(location.pathname + location.search + location.hash);
  }, [crossing, location.pathname, location.search, location.hash, replace]);
  return crossing ? null : children;
}
