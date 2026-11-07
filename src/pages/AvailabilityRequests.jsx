import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import { availabilityService } from '../services/availability.service';
import { availabilityItemSummary } from '../components/Availability/AvailabilityItem';
import { getErrorMessage } from '../utils/errorMessages';
import '../components/Availability/AvailabilityApproval.css';
export default function AvailabilityRequests() {
  const { t, i18n } = useTranslation();
  const { selectedBranchId, branches, barbers } = useApp();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'pending';
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [shopId, setShopId] = useState(selectedBranchId || '');
  const [barberId, setBarberId] = useState(params.get('barber') || '');
  const [category, setCategory] = useState('');
  const [result, setResult] = useState({ requests: [], loading: true });
  useEffect(() => { setShopId(selectedBranchId || ''); setPage(0); }, [selectedBranchId]);
  useEffect(() => {
    let current = true; setResult({ requests: [], loading: true });
    availabilityService.call('list', { branch_id: shopId || undefined, barber_id: barberId || undefined, status, category: category || undefined, offset: page * 20 })
      .then(value => { if (current) setResult(value); })
      .catch(error => { if (current) setResult({ requests: [], error }); });
    return () => { current = false; };
  }, [shopId, barberId, status, category, page, refresh]);
  const filter = setter => event => { setter(event.target.value); setPage(0); };
  return <div className="availability-requests-page"><div className="page-header"><div><h1 className="page-title">{t('availabilityApproval.requests')}</h1><p>{t('availabilityItems.listHelp')}</p></div>
    <button className="btn btn-secondary" onClick={() => setRefresh(value => value + 1)}>{t('availabilityApproval.reload')}</button></div>
    <div className="availability-status-tabs" role="group" aria-label={t('availabilityItems.status')}>
      {['pending','approved','declined'].map(value => <button key={value} className={`btn ${status === value ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={status === value} onClick={() => { setParams(previous => { const next = new URLSearchParams(previous); next.set('status', value); return next; }); setPage(0); }}>{t(`availabilityItems.${value}`)}</button>)}
    </div>
    <div className="availability-list-filters">
      <label>{t('availabilityItems.shop')}<select className="form-select" value={shopId} onChange={event => { setShopId(event.target.value); setBarberId(''); setPage(0); }}><option value="">{t('availabilityItems.allShops')}</option>{branches.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></label>
      <label>{t('availabilityItems.barber')}<select className="form-select" value={barberId} onChange={filter(setBarberId)}><option value="">{t('availabilityItems.allBarbers')}</option>{barbers.filter(barber => !barber.managerChair && (!shopId || barber.branchId === shopId)).map(barber => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select></label>
      <label>{t('availabilityItems.type')}<select className="form-select" value={category} onChange={filter(setCategory)}><option value="">{t('availabilityItems.allTypes')}</option>{['hours','break','vacation'].map(type => <option key={type} value={type}>{t(`availabilityItems.${type}`)}</option>)}</select></label>
    </div>
    {result.loading && <p role="status">{t('common.loading')}</p>}
    {result.error && <p role="alert">{getErrorMessage(result.error, t('common.error'), t)}</p>}
    {!result.loading && !result.error && result.requests.length === 0 && <p>{t('availabilityItems.empty')}</p>}
    {result.requests.slice(0,20).map(request => <article className="availability-request-card" key={request.id}>
      <div className="availability-request-heading"><span className="availability-item-type">{t(`availabilityItems.${request.category}`)}</span><span>{t(`availabilityItems.${request.status}`)}</span></div>
      <h2>{request.barber_name}</h2><p>{request.shop_name}</p><p>{availabilityItemSummary(request, t)}</p>
      <p className="text-muted">{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(request.created_at))}</p>
      <Link className="btn btn-primary" to={`/dashboard/availability-requests/${request.id}`}>{t(status === 'pending' ? 'availabilityApproval.review' : 'availabilityItems.viewDecision')}</Link>
    </article>)}
    <div className="page-actions"><button className="btn btn-secondary" disabled={page === 0 || result.loading} onClick={() => setPage(value => value - 1)}>{t('common.previous')}</button>
      <span aria-live="polite">{t('availabilityItems.page', { count: page + 1 })}</span>
      <button className="btn btn-secondary" disabled={result.requests.length < 21 || result.loading} onClick={() => setPage(value => value + 1)}>{t('common.next')}</button></div>
  </div>;
}
