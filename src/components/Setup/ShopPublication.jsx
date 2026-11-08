import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shopPublicationService } from '../../services/shopPublication.service';
import { getErrorMessage } from '../../utils/errorMessages';
import Modal from '../UI/Modal';
import './ShopPublication.css';

export default function ShopPublication({ branchId, name, admin = false, onChanged }) {
  const { t } = useTranslation();
  const tr = key => t('shopPublication.' + key);
  const [data, setData] = useState(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(null); const [revision, setRevision] = useState(0);
  const scope = useRef(branchId); scope.current = branchId;
  useEffect(() => {
    let active = true; setData(null); setError(''); setConfirm(null); setBusy(true);
    shopPublicationService.manage(branchId).then(value => { if (active) setData(value); })
      .catch(failure => { if (active) setError(getErrorMessage(failure, tr('failed'), t)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [branchId, revision]);
  async function act(action) {
    if (busy || !data) return;
    const id = branchId; setBusy(true); setError('');
    try {
      const value = await shopPublicationService.manage(id, action, data.publication_state);
      if (scope.current === id) { setData(value); setConfirm(null); onChanged?.(); }
    } catch (failure) {
      if (scope.current === id) { setError(getErrorMessage(failure, tr('failed'), t)); setConfirm(null); }
    } finally { if (scope.current === id) setBusy(false); }
  }
  const state = data?.publication_state;
  const action = admin ? data?.paused_manual_booking_allowed ? 'block-manual' : 'allow-manual' : state === 'published' ? 'pause' : 'publish';
  return <section className="shop-publication" aria-label={tr(admin ? 'permissions' : 'title')} aria-busy={busy}>
    <div className="shop-publication-row">
      <strong>{state ? tr(state) : t('common.loading')}</strong>
      {data && (!admin || state === 'paused') && <button type="button" className={'btn ' + (action === 'publish' ? 'btn-primary' : 'btn-secondary')} disabled={busy || action === 'publish' && !data.ready} onClick={() => setConfirm(action)}>{tr(action)}</button>}
    </div>
    {!admin && data && action === 'publish' && !data.ready && <p>{tr('notReady')}</p>}
    {!admin && state === 'paused' && <p>{tr(data.paused_manual_booking_allowed ? 'manualAllowed' : 'manualBlocked')}</p>}
    {error && <div><p className="error-banner" role="alert">{error}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>{t('common.refresh')}</button></div>}
    <Modal isOpen={Boolean(confirm)} onClose={() => { if (!busy) setConfirm(null); }} title={confirm ? tr(confirm) : ''}>
      <div role="dialog" aria-modal="true" aria-label={confirm ? tr(confirm) : ''}>
      <p>{name}</p><p>{confirm ? tr(confirm + 'Confirm') : ''}</p>
      <div className="shop-publication-row"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>{t('common.cancel')}</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(confirm)}>{confirm ? tr(confirm) : ''}</button></div>
      </div>
    </Modal>
  </section>;
}
