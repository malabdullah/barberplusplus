import React, { useEffect, useState } from 'react';
import { Store, UserRound } from 'lucide-react';
import { safeBookingUrl } from '../../utils/customerBooking';
export default function BookingImage({ src, name, person = false }) {
  const [failed, setFailed] = useState(false);
  const url = safeBookingUrl(src);
  useEffect(() => setFailed(false), [src]);
  const Fallback = person ? UserRound : Store;
  return <span className={`cb-image ${person ? 'cb-avatar' : ''}`}>
    {url && !failed ? <img src={url} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <Fallback size={26} aria-hidden="true" />}
  </span>;
}
