import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Share2 } from 'lucide-react';
import { bookingShareService } from '../../services/bookingShare.service';
import './BookingShare.css';

export default function BookingShareControls({ bookingId, receipt, revision = '', menuItem = false }) {
  const { t } = useTranslation();
  const [preparing, setPreparing] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const button = useRef(null);
  const link = useRef(null);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const pending = useRef(false);
  const tr = key => t(`bookingShare.${key}`);

  const prepare = useCallback(async () => {
    const id = ++requestId.current;
    link.current = null; pending.current = true;
    setPreparing(true); setError(''); setMessage(''); setManualUrl('');
    try {
      const result = await bookingShareService.create(bookingId, receipt);
      if (id !== requestId.current) return null;
      link.current = result;
      return result;
    } catch (failure) {
      if (id === requestId.current) setError(failure.message);
      return null;
    } finally { if (id === requestId.current) { pending.current = false; setPreparing(false); } }
  }, [bookingId, receipt]);

  useEffect(() => {
    mounted.current = true;
    const menu = button.current?.closest('details');
    // Prepare while the action becomes visible, before the click. Safari's
    // system share/clipboard APIs need the click's transient user activation.
    const ready = () => { if (!submitting.current && !pending.current && !link.current && (!menu || menu.open)) prepare(); };
    const focus = () => { if (!submitting.current) { link.current = null; ready(); } };
    const toggle = () => {
      if (menu.open) ready();
      else { requestId.current += 1; link.current = null; pending.current = false; setPreparing(true); }
    };
    ready();
    menu?.addEventListener('toggle', toggle);
    window.addEventListener('focus', focus);
    return () => {
      mounted.current = false; requestId.current += 1; link.current = null; pending.current = false;
      menu?.removeEventListener('toggle', toggle);
      window.removeEventListener('focus', focus);
    };
  }, [prepare, revision]);

  async function share() {
    if (submitting.current) return;
    submitting.current = true;
    setSharing(true); setError(''); setMessage(''); setManualUrl('');
    const menu = button.current?.closest('details');
    try {
      let ready = link.current;
      if (!ready || new Date(ready.expiresAt).getTime() <= Date.now()) ready = await prepare();
      if (!ready || !mounted.current) return;
      const operation = requestId.current;
      const current = () => mounted.current && requestId.current === operation;
      if (navigator.share) {
        try {
          const sending = navigator.share({ title: tr('title'), url: ready.url });
          await sending;
          menu?.removeAttribute('open');
          return;
        } catch (failure) { if (failure.name === 'AbortError') { menu?.removeAttribute('open'); return; } }
      }
      if (!current()) return;
      try {
        await navigator.clipboard.writeText(ready.url);
        if (current()) {
          setMessage(tr('copied'));
        }
      } catch {
        if (current()) {
          setManualUrl(ready.url); setMessage(tr('copyManually'));
        }
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setSharing(false);
    }
  }

  return <>
    <button ref={button} type="button" className={menuItem ? undefined : 'cb-secondary'} disabled={preparing || sharing}
      aria-busy={preparing || sharing} onClick={share}>
      {preparing || sharing ? <Loader2 className="cb-spinner" size={17} aria-hidden="true" /> : <Share2 size={17} aria-hidden="true" />}{tr('share')}
    </button>
    {message && <p className="bs-share-feedback" role="status">{message}</p>}
    {manualUrl && <input className="cb-input bs-share-manual" aria-label={tr('link')} readOnly value={manualUrl} onFocus={event => event.target.select()} />}
    {error && <p className="bs-share-feedback cb-alert" role="alert">{tr(error === 'AUTH_REQUIRED' ? 'signInRequired' : error === 'LINK_UNAVAILABLE' ? 'cannotShare' : 'error')}</p>}
  </>;
}
