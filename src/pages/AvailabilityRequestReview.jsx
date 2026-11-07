import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import { availabilityService } from '../services/availability.service';
import { AvailabilityItemValue } from '../components/Availability/AvailabilityItem';
import AvailabilityQuickActions from '../components/Availability/AvailabilityQuickActions';
import { getErrorMessage } from '../utils/errorMessages';
import '../components/Availability/AvailabilityApproval.css';
export default function AvailabilityRequestReview() {
  const { requestId } = useParams();
  const { t, i18n } = useTranslation();
  const { reloadData, barbers, branches } = useApp();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState(null);
  const item = detail?.selected_request;
  useEffect(() => { setNotice(null); }, [requestId]);
  useEffect(() => {
    let current = true; setLoading(true); setDetail(null); setError(null);
    availabilityService.call('get', { request_id: requestId }).then(result => { if (current) { setDetail(result); } })
      .catch(failure => { if (current) setError(failure); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [requestId, refresh]);
  const decided = async (id, status) => {
    setNotice(status); setRefresh(previous => previous + 1);
    await reloadData();
  };
  const barber = barbers.find(person => person.id === detail?.barber.id);
  const shop = branches.find(branch => branch.id === detail?.barber.branch_id);
  return <div className="availability-item-review">
    <Link className="availability-back" to="/dashboard/availability-requests">{t('availabilityItems.back')}</Link>
    {loading && <p role="status">{t('common.loading')}</p>}
    {error && <p className="form-error" role="alert">{getErrorMessage(error, t('common.error'), t)}</p>}
    {notice && <p className="availability-decision-notice" role="status">{t(`availabilityItems.${notice}Notice`)}</p>}
    {!loading && !detail && <button className="btn btn-secondary" onClick={() => setRefresh(previous => previous + 1)}>{t('availabilityApproval.reload')}</button>}
    {item && <>
      <header className="page-header"><div><p className="availability-item-type">{t(`availabilityItems.${item.category}`)}</p>
        <h1 className="page-title">{barber?.name || detail.barber.name}</h1><p>{shop?.name}</p><p>{t(`availabilityItems.${item.status}`)} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(item.created_at))}</p></div>
        <button className="btn btn-secondary" onClick={() => setRefresh(previous => previous + 1)}>{t('availabilityApproval.reload')}</button>
      </header>
      {item.category === 'legacy' ? <section className="availability-approval-panel">{detail.related_items.map(related => <p key={related.id}><Link to={`/dashboard/availability-requests/${related.id}`}>{t(`availabilityItems.${related.category}`)} · {t(`availabilityItems.${related.status}`)}</Link></p>)}</section> : <>
        <div className="availability-item-comparison"><section><h2>{t('availabilityItems.previous')}</h2><AvailabilityItemValue category={item.category} value={item.base_value} /></section>
          <section><h2>{t(item.requested_value ? 'availabilityItems.requested' : 'availabilityItems.removal')}</h2>{item.requested_value ? <AvailabilityItemValue category={item.category} value={item.requested_value} /> : <p>{t('availabilityItems.remove')}</p>}</section>
          {item.status === 'approved' && <section><h2>{t('availabilityItems.approvedResult')}</h2><AvailabilityItemValue category={item.category} value={item.approved_value} /></section>}
        </div>
        {item.review_note && <div className="availability-approval-panel"><h2>{t('availabilityItems.reviewNote')}</h2><p>{item.review_note}</p></div>}
        {item.status === 'pending' && <div className="availability-review-actions"><AvailabilityQuickActions key={item.id} item={item} onDecided={decided} onAction={() => setNotice(null)} /></div>}
      </>}
    </>}
  </div>;
}
