import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { barberInvitationsService as api } from '../../services/barberInvitations.service';
import ConfirmDialog from '../UI/ConfirmDialog';
import './Invitations.css';
export default function PendingInvitations({ branchId }) {
  const { t } = useTranslation(); const tr = (key, options) => t('barberInvitations.' + key, options);
  const [rows, setRows] = useState([]); const [offset, setOffset] = useState(0); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [notice, setNotice] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!branchId) return; setLoading(true); setError('');
    try {
      const result = await api.list(branchId, offset);
      if (request === generation.current) setRows(result.invitations);
    } catch (e) { if (request === generation.current) setError(e.message); }
    finally { if (request === generation.current) setLoading(false); }
  }, [branchId, offset]);
  useEffect(() => { setRows([]); setOffset(0); setCancelling(null); setNotice(''); }, [branchId]);
  useEffect(() => { load(); return () => { generation.current += 1; }; }, [load]);
  const act = async (action, row) => {
    if (busy) return; const request = generation.current; setBusy(true); setNotice(''); setError('');
    try { const result = await api[action](row.id); if (request !== generation.current) return; setNotice(action === 'cancel' ? 'cancelled' : result.delivered ? 'sent' : 'deliveryFailed'); setCancelling(null); await load(); }
    catch (e) { if (request === generation.current) setError(e.message); } finally { setBusy(false); }
  };
  if (!branchId) return null;
  return <section className="barber-invitations" aria-labelledby="invitations-title">
    <div className="invitation-heading"><h3 id="invitations-title">{tr('invitations')}</h3><button className="btn btn-secondary btn-sm" disabled={busy || loading} onClick={load}>{t('common.refresh')}</button></div>
    {error && <p role="alert">{tr('errors.' + error)}</p>}
    {notice && <p role={notice === 'deliveryFailed' ? 'alert' : 'status'}>{tr(notice)}</p>}
    {loading && <p role="status">{t('common.loading')}</p>}
    {!loading && !rows.length && <p>{tr('none')}</p>}
    {rows.slice(0, 10).map(row => {
      const expired = Date.parse(row.expires_at) <= Date.now(); const pending = row.status === 'pending';
      const status = !pending ? row.status : row.delivery === 'failed' ? 'deliveryFailed' : expired ? 'expired' : 'pending';
      return <div className="invitation-row" key={row.id}><div className="invitation-copy"><strong><bdi>{row.email}</bdi></strong><span>{tr(status)}</span></div>
        {pending && <div className="invitation-actions"><button className="btn btn-secondary btn-sm" disabled={busy || loading} onClick={() => act('resend', row)}>{tr('resend')}</button><button className="btn btn-ghost btn-sm" disabled={busy || loading} onClick={() => setCancelling(row)}>{tr('cancel')}</button></div>}
      </div>;
    })}
    {(offset > 0 || rows.length > 10) && <div className="invitation-actions"><button className="btn btn-secondary btn-sm" disabled={busy || loading || !offset} onClick={() => setOffset(x => Math.max(0, x - 10))}>{t('common.previous')}</button><button className="btn btn-secondary btn-sm" disabled={busy || loading || rows.length <= 10} onClick={() => setOffset(x => x + 10)}>{t('common.next')}</button></div>}
    <ConfirmDialog isOpen={Boolean(cancelling)} onClose={() => !busy && setCancelling(null)} onConfirm={() => act('cancel', cancelling)} title={tr('cancel')} message={tr('cancelConfirm', { email: cancelling?.email })} confirmText={tr('cancel')} variant="danger" />
  </section>;
}
