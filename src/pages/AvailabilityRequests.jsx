import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import { availabilityService } from '../services/availability.service';
import { availabilityItemSummary } from '../components/Availability/AvailabilityItem';
import { DAYS } from '../constants/time';
import AvailabilityQuickActions from '../components/Availability/AvailabilityQuickActions';
import { getErrorMessage } from '../utils/errorMessages';
import '../components/Availability/AvailabilityApproval.css';
export default function AvailabilityRequests() {
  const { t, i18n } = useTranslation();
  const { selectedBranchId, branches, barbers, reloadData } = useApp();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'pending';
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [shopId, setShopId] = useState(selectedBranchId || '');
  const [barberId, setBarberId] = useState(params.get('barber') || '');
  const [category, setCategory] = useState('');
  const [notice, setNotice] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [result, setResult] = useState({ requests: [], loading: true });
  useEffect(() => { setNotice(null); }, [shopId, barberId, status, category, page]);
  useEffect(() => { setShopId(selectedBranchId || ''); setPage(0); }, [selectedBranchId]);
  useEffect(() => {
    let current = true; setResult({ requests: [], loading: true });
    availabilityService.call('list', { branch_id: shopId || undefined, barber_id: barberId || undefined, status, category: category || undefined, offset: page * 20 })
      .then(value => { if (current) setResult(value); })
      .catch(error => { if (current) setResult({ requests: [], error }); });
    return () => { current = false; };
  }, [shopId, barberId, status, category, page, refresh]);
  const filter = setter => event => { setter(event.target.value); setPage(0); };
  const decided = (id, decision) => {
    setResult(previous => ({ ...previous, requests: previous.requests.filter(request => request.id !== id) }));
    setNotice(decision);
    setRefresh(value => value + 1);
    reloadData();
  };
  return <div className="availability-requests-page"><div className="page-header"><h1 className="page-title">{t('availabilityApproval.requests')}</h1>
    <button className="btn btn-secondary" onClick={() => setRefresh(value => value + 1)}>{t('availabilityItems.refresh')}</button></div>
    <div className="availability-status-tabs" role="group" aria-label={t('availabilityItems.status')}>
      {['pending','approved','declined'].map(value => <button key={value} className={`btn ${status === value ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={status === value} onClick={() => { setParams(previous => { const next = new URLSearchParams(previous); next.set('status', value); return next; }); setPage(0); }}>{t(`availabilityItems.${value}`)}</button>)}
    </div>
    <button className="btn btn-secondary availability-filter-toggle" aria-expanded={filtersOpen} aria-controls="availability-filters" onClick={() => setFiltersOpen(value => !value)}>{t('availabilityItems.filters')}</button>
    <div id="availability-filters" className={`availability-list-filters ${filtersOpen ? 'is-open' : ''}`}>
      <label>{t('availabilityItems.shop')}<select className="form-select" value={shopId} onChange={event => { setShopId(event.target.value); setBarberId(''); setPage(0); }}><option value="">{t('availabilityItems.allShops')}</option>{branches.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></label>
      <label>{t('availabilityItems.barber')}<select className="form-select" value={barberId} onChange={filter(setBarberId)}><option value="">{t('availabilityItems.allBarbers')}</option>{barbers.filter(barber => !barber.managerChair && (!shopId || barber.branchId === shopId)).map(barber => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select></label>
      <label>{t('availabilityItems.type')}<select className="form-select" value={category} onChange={filter(setCategory)}><option value="">{t('availabilityItems.allTypes')}</option>{['hours','break','vacation'].map(type => <option key={type} value={type}>{t(`availabilityItems.${type}`)}</option>)}</select></label>
    </div>
    {notice && <p className="availability-list-notice" role="status">{t(`availabilityItems.${notice}`)}</p>}
    {result.loading && <p role="status">{t('common.loading')}</p>}
    {result.error && <p role="alert">{getErrorMessage(result.error, t('common.error'), t)}</p>}
    {!result.loading && !result.error && result.requests.length === 0 && <p>{t('availabilityItems.empty')}</p>}
    <div className="availability-request-list">{result.requests.slice(0,20).map(request => {
      const requested = request.status === 'approved' ? request.approved_value : request.requested_value;
      const value = requested || request.base_value;
      const groups = request.category === 'hours' && value ? DAYS.reduce((all, { key }) => {
        const day = value.availability?.[key];
        const time = day?.enabled ? `${day.start}–${day.end}` : t('availability.dayOff');
        const existing = all.find(group => group.time === time);
        if (existing) existing.days.push(t(`days.${key}`)); else all.push({ time, days: [t(`days.${key}`)] });
        return all;
      }, []) : [];
      return <article className="availability-request-row" key={request.id} aria-label={`${request.barber_name} · ${t(`availabilityItems.${request.category}`)}`}>
        <header className="availability-row-heading"><div><span className="availability-item-type">{t(`availabilityItems.${request.category}`)}</span><h2>{request.barber_name}</h2><p>{request.shop_name}</p></div>
          <time dateTime={request.created_at}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'Asia/Kuwait' }).format(new Date(request.created_at))}</time></header>
        <div className="availability-row-value">
          {groups.length > 0 && <dl className="availability-compact-hours">{groups.map(group => <div key={group.time}><dt>{group.days.join(i18n.language.startsWith('ar') ? '، ' : ', ')}</dt><dd><bdi>{group.time}</bdi></dd></div>)}</dl>}
          {!requested && <p className="availability-removal">{t('availabilityItems.removal')}</p>}
          <p className={groups.length ? 'text-muted' : undefined}><bdi>{availabilityItemSummary({ ...request, requested_value: value, approved_value: value }, t)}</bdi></p>
          {value?.reason && <p className="text-muted">{value.reason}</p>}
          {request.review_note && <p>{request.review_note}</p>}
          <Link className="availability-details-link" to={`/dashboard/availability-requests/${request.id}`}>{t('availabilityItems.details')}</Link>
        </div>
        {request.status === 'pending' && <AvailabilityQuickActions item={request} onDecided={decided} onAction={() => setNotice(null)} />}
      </article>;
    })}</div>
    <div className="page-actions"><button className="btn btn-secondary" disabled={page === 0 || result.loading} onClick={() => setPage(value => value - 1)}>{t('common.previous')}</button>
      <span aria-live="polite">{t('availabilityItems.page', { count: page + 1 })}</span>
      <button className="btn btn-secondary" disabled={result.requests.length < 21 || result.loading} onClick={() => setPage(value => value + 1)}>{t('common.next')}</button></div>
  </div>;
}
