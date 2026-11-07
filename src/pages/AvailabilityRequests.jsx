import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import { availabilityService } from '../services/availability.service';
import { getErrorMessage } from '../utils/errorMessages';
import '../components/Availability/AvailabilityApproval.css';
export default function AvailabilityRequests() {
  const { t, i18n } = useTranslation();
  const { selectedBranchId, selectedBranch } = useApp();
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState({ requests: [], loading: true });
  useEffect(() => { setPage(0); }, [selectedBranchId]);
  useEffect(() => {
    let current = true; setResult({ requests: [], loading: true });
    availabilityService.call('list', { branch_id: selectedBranchId, status: 'pending', offset: page * 20 })
      .then(value => { if (current) setResult(value); })
      .catch(error => { if (current) setResult({ requests: [], error }); });
    return () => { current = false; };
  }, [selectedBranchId, page, refresh]);
  return <div><div className="page-header"><div><h1>{t('availabilityApproval.requests')}</h1><p>{selectedBranch?.name}</p></div>
    <button className="btn btn-secondary" onClick={() => setRefresh(value => value + 1)}>{t('availabilityApproval.reload')}</button></div>
    {result.loading && <p role="status">{t('common.loading')}</p>}
    {result.error && <p role="alert">{getErrorMessage(result.error, t('common.error'), t)}</p>}
    {!result.loading && !result.error && result.requests.length === 0 && <p>{t('availabilityApproval.noRequests')}</p>}
    {result.requests.slice(0,20).map(request => <article className="availability-request-card" key={request.id}>
      <h2>{request.barber_name}</h2><p>{request.shop_name} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(request.created_at))}</p>
      <Link className="btn btn-primary" to={`/dashboard/barbers/${request.barber_id}/schedule?request=${request.id}`}>{t('availabilityApproval.review')}</Link>
    </article>)}
    <div className="page-actions"><button className="btn btn-secondary" disabled={page === 0 || result.loading} onClick={() => setPage(value => value - 1)}>{t('common.previous')}</button>
    <button className="btn btn-secondary" disabled={result.requests.length < 21 || result.loading} onClick={() => setPage(value => value + 1)}>{t('common.next')}</button></div>
  </div>;
}
