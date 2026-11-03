import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import { bookingsService } from '../services/bookings.service';
import { getKuwaitDate } from '../utils/customerBooking';
import MyAvailability from './barber/MyAvailability';
import MyProfile from './barber/MyProfile';
import './MyChair.css';

const pageSize = 20;
const views = ['upcoming', 'history', 'profile', 'hours'];
const errors = {
  CHAIR_SHOP_NOT_ALLOWED: 'chair.shopUnavailable',
  CHAIR_SERVICES_REQUIRED: 'chair.servicesRequired',
  CHAIR_HOURS_REQUIRED: 'chair.hoursRequired',
  '23505': 'chair.alreadyCreated',
};

function ChairAppointments({ chair, history }) {
  const { t, i18n } = useTranslation();
  const { services, setSelectedBranchId } = useApp();
  const [page, setPage] = useState(0);
  const [request, setRequest] = useState({ appointments: [], pending: true, failed: false });
  useEffect(() => {
    let current = true;
    const now = new Date();
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(now);
    bookingsService.getChairAppointments({
      branchId: chair.branchId, barberId: chair.id, history, today: getKuwaitDate(now),
      time, start: page * pageSize, count: pageSize + 1,
    }).then(appointments => {
      if (current) setRequest({ appointments, pending: false, failed: false });
    }).catch(() => {
      if (current) setRequest({ appointments: [], pending: false, failed: true });
    });
    return () => { current = false; };
  }, [chair.id, chair.branchId, history, page]);

  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' });
  const goToPage = next => {
    setRequest(previous => ({ ...previous, pending: true }));
    setPage(next);
  };
  if (request.failed) return <p role="alert">{t('chair.loadFailed')}</p>;

  return (
    <section className="chair-card" aria-busy={request.pending}>
      <h2>{t(history ? 'chair.history' : 'chair.upcoming')}</h2>
      {request.pending ? <p role="status">{t('common.loading')}</p> : (
        <>
          {request.appointments.length ? (
            <ul className="chair-appointments">
              {request.appointments.slice(0, pageSize).map(booking => {
                const names = booking.serviceIds.map(id => services.find(service => service.id === id)?.name).filter(Boolean);
                const status = ['no-show', 'no_show'].includes(booking.status) ? 'noShow' : booking.status;
                return (
                  <li key={booking.id}>
                    <div>
                      <strong>{booking.customerName || t('chair.appointment')}</strong>
                      <p>{dateFormat.format(new Date(`${booking.date}T${booking.time.slice(0, 5)}:00+03:00`))}</p>
                      {names.length > 0 && <p>{names.join(t('chair.separator'))}</p>}
                      <p>{t(`bookings.status.${status}`)}</p>
                    </div>
                    <Link
                      className="btn btn-secondary"
                      to={`/dashboard/bookings?booking=${booking.id}`}
                      onClick={() => setSelectedBranchId(chair.branchId)}
                    >{t('chair.openAppointment')}</Link>
                  </li>
                );
              })}
            </ul>
          ) : <p>{t(history ? 'chair.noHistory' : 'chair.noUpcoming')}</p>}
          {(page > 0 || request.appointments.length > pageSize) && (
            <div className="chair-actions">
              <button className="btn btn-secondary" disabled={page === 0} onClick={() => goToPage(page - 1)}>{t('chair.previous')}</button>
              <button className="btn btn-secondary" disabled={request.appointments.length <= pageSize} onClick={() => goToPage(page + 1)}>{t('chair.next')}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function MyChair() {
  const { t, i18n } = useTranslation();
  const { user, branches, loading, managerChair: chair, createManagerChair, updateBarber } = useApp();
  const [params] = useSearchParams();
  const view = views.includes(params.get('view')) ? params.get('view') : 'upcoming';
  const [branchId, setBranchId] = useState('');
  const [name, setName] = useState(user?.user_metadata?.name || '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const shops = branches.filter(branch => branch.managerId === user?.id && branch.status === 'active');
  const chairShop = branches.find(branch => branch.id === chair?.branchId && branch.managerId === user?.id);
  const shopName = shop => (i18n.language === 'ar' && shop?.nameAr) || shop?.name;
  const active = chair?.status === 'active';

  const save = async (action, success) => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(t(success));
    } catch (failure) {
      setError(t(errors[failure.message] || errors[failure.code] || 'chair.saveFailed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="chair-page">
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">{t('chair.title')}</h1>
          <p className="page-description">{t('chair.settingsDescription')}</p>
        </div>
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="alert alert-info" role="status">{notice}</p>}
      {loading && !chair ? <p role="status">{t('common.loading')}</p> : !chair ? (
        <section className="chair-card">
          <h2>{t('chair.setupTitle')}</h2>
          <p>{t('chair.setupHelp')}</p>
          {shops.length ? (
            <form className="chair-form" onSubmit={event => {
              event.preventDefault();
              if (!pending && branchId && name.trim()) {
                save(() => createManagerChair(branchId, name.trim()), 'chair.created');
              }
            }}>
              <div className="form-group">
                <label className="form-label" htmlFor="chair-shop">{t('chair.shop')}</label>
                <select className="form-input form-select" id="chair-shop" value={branchId} onChange={event => setBranchId(event.target.value)} required>
                  <option value="">{t('chair.chooseShop')}</option>
                  {shops.map(shop => <option key={shop.id} value={shop.id}>{shopName(shop)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="chair-name">{t('chair.publicName')}</label>
                <input className="form-input" id="chair-name" value={name} onChange={event => setName(event.target.value)} maxLength={100} required />
              </div>
              <button className="btn btn-primary" disabled={pending || !branchId || !name.trim()}>{t('chair.create')}</button>
            </form>
          ) : <p>{t('chair.noShops')}</p>}
        </section>
      ) : chairShop ? (
        <>
          <section className="chair-card chair-status">
            <div>
              <h2>{shopName(chairShop)}</h2>
              <p><strong>{t(active ? 'chair.active' : 'chair.inactive')}</strong></p>
              <p>{t(active ? 'chair.activeHelp' : 'chair.inactiveHelp')}</p>
            </div>
            <button
              className={`btn ${active ? 'btn-secondary' : 'btn-primary'}`}
              disabled={pending || (!active && chairShop.status !== 'active')}
              onClick={() => save(() => updateBarber(chair.id, { status: active ? 'inactive' : 'active' }), active ? 'chair.stopped' : 'chair.started')}
            >{t(active ? 'chair.stop' : 'chair.start')}</button>
          </section>
          <nav className="chair-nav" aria-label={t('chair.title')}>
            {views.map(item => (
              <Link key={item} to={`?view=${item}`} className={`btn ${view === item ? 'btn-primary' : 'btn-secondary'}`} aria-current={view === item ? 'page' : undefined}>
                {t(`chair.${item}`)}
              </Link>
            ))}
          </nav>
          {view === 'profile' && <MyProfile chair />}
          {view === 'hours' && <MyAvailability />}
          {(view === 'upcoming' || view === 'history') && <ChairAppointments key={view} chair={chair} history={view === 'history'} />}
        </>
      ) : <p className="chair-card" role="status">{t('chair.shopUnavailable')}</p>}
    </div>
  );
}
