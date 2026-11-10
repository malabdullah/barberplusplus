import React from 'react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import './ManagedBarbers.css';
import MyAvailability from './barber/MyAvailability';

export default function BarberSchedule() {
  const { barberId } = useParams();
  const [params] = useSearchParams();
  const { barbers, loading } = useApp();
  const { t } = useTranslation();
  const location = useLocation();
  const barber = barbers.find(item => item.id === barberId);
  if (params.get('request')) return <Navigate replace to={`/dashboard/availability-requests/${encodeURIComponent(params.get('request'))}`} />;
  if (loading) return <p role="status">{t('common.loading')}</p>;
  return <><Link to="/dashboard/barbers">{t('barbers.backToBarbers')}</Link>
    {location.state?.imageWarning && <p role="alert">{t('managerAudit.imageWarning')}</p>}
    {barber?.managerManaged && <nav className="managed-barber-tabs" aria-label={t('managedBarbers.manage')}>
      <Link className="btn btn-secondary" to={`/dashboard/barbers/${barber.id}/edit`}>{t('profile.title')}</Link>
      <span className="btn btn-primary" aria-current="page">{t('availabilityCompact.title')}</span>
      <Link className="btn btn-secondary" to={`/dashboard/barbers/${barber.id}/edit?tab=settings`}>{t('settings.title')}</Link>
    </nav>}
    {barber ? <MyAvailability targetBarber={barber} /> : <p role="alert">{t('barbers.barberNotFound')}</p>}</>;
}
