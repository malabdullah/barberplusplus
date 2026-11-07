import React from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import MyAvailability from './barber/MyAvailability';

export default function BarberSchedule() {
  const { barberId } = useParams();
  const [params] = useSearchParams();
  const { barbers, loading } = useApp();
  const { t } = useTranslation();
  const barber = barbers.find(item => item.id === barberId);
  if (params.get('request')) return <Navigate replace to={`/dashboard/availability-requests/${encodeURIComponent(params.get('request'))}`} />;
  if (loading) return <p role="status">{t('common.loading')}</p>;
  return <><Link to="/dashboard/barbers">{t('barbers.backToBarbers')}</Link>
    {barber ? <MyAvailability targetBarber={barber} /> : <p role="alert">{t('barbers.barberNotFound')}</p>}</>;
}
