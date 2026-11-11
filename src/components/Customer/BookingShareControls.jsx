import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Link2, Loader2, Share2 } from 'lucide-react';
import { bookingShareService } from '../../services/bookingShare.service';
import './BookingShare.css';

export default function BookingShareControls({ bookingId, receipt, menuItem = false }) {
  const { t, i18n } = useTranslation();
  const tr = key => t(`bookingShare.${key}`);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dialog = useRef(null);
  const requestId = useRef(0);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  useEffect(() => () => { requestId.current += 1; }, []);
  async function create() {
    const id = ++requestId.current;
    setBusy(true); setError(''); setMessage(''); setLink(null);
    try { const result = await bookingShareService.create(bookingId, receipt); if (id === requestId.current) setLink(result); }
    catch (failure) { if (id === requestId.current) setError(failure.message); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link.url); setMessage(tr('copied')); }
    catch { setMessage(tr('copyManually')); }
  }
  async function share() {
    if (!navigator.share) { await copy(); return; }
    try { await navigator.share({ title: tr('title'), url: link.url }); }
    catch (failure) { if (failure.name !== 'AbortError') await copy(); }
  }
  async function stop() {
    setBusy(true); setError(''); setMessage('');
    try { await bookingShareService.revoke(bookingId, receipt); setLink(null); setMessage(tr('stopped')); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className={menuItem ? undefined : 'cb-secondary'} onClick={event => {
      event.currentTarget.closest('details')?.removeAttribute('open'); setOpen(true); create();
    }}><Share2 size={17} aria-hidden="true" />{tr('share')}</button>
    {createPortal(<dialog className="bs-share-dialog" dir={i18n.resolvedLanguage?.startsWith('ar') ? 'rtl' : 'ltr'} ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) setOpen(false); }}>
      <div className="bs-share-body">
        <span className="bs-share-symbol" aria-hidden="true"><Link2 size={24} /></span>
        <h3 id={titleId}>{tr('title')}</h3>
        <p>{tr('privacy')}</p>
        {busy && <p className="bs-loading" role="status"><Loader2 className="cb-spinner" size={20} aria-hidden="true" />{tr('loading')}</p>}
        {link && <>
          <div className="bs-share-buttons">
            <button type="button" className="cb-primary" onClick={share} disabled={busy}><Share2 size={18} aria-hidden="true" />{tr('shareLink')}</button>
            <button type="button" className="cb-secondary" onClick={copy} disabled={busy}><Copy size={18} aria-hidden="true" />{tr('copy')}</button>
          </div>
          <div className="bs-share-links">
            <a href={link.url} target="_blank" rel="noreferrer" className="cb-text-button"><ExternalLink size={16} aria-hidden="true" />{tr('preview')}</a>
            <button type="button" className="cb-text-button bs-stop" onClick={stop} disabled={busy}>{tr('stop')}</button>
          </div>
          <p className="bs-share-expiry">{t('bookingShare.expires', { date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeZone: 'Asia/Kuwait', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(link.expiresAt)) })}</p>
          {message === tr('copyManually') && <input className="cb-input" aria-label={tr('link')} readOnly value={link.url} onFocus={event => event.target.select()} />}
        </>}
        {!link && !busy && !error && <button type="button" className="cb-primary" onClick={create}>{tr('newLink')}</button>}
        {message && <p role="status">{message}</p>}
        {error && <p className="cb-alert" role="alert">{tr(error === 'AUTH_REQUIRED' ? 'signInRequired' : error === 'LINK_UNAVAILABLE' ? 'cannotShare' : 'error')}</p>}
      </div>
      <div className="bs-share-footer"><button className="cb-secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>{tr('close')}</button></div>
    </dialog>, document.body)}
  </>;
}
