import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import MyAvailability from './barber/MyAvailability';

export default function BarberSchedule() {
  const { barberId } = useParams();
  const { barbers, loading } = useApp();
  const { t } = useTranslation();
  const barber = barbers.find(item => item.id === barberId);
  if (loading) return <p role="status">{t('common.loading')}</p>;
  return <><Link to="/dashboard/barbers">{t('barbers.backToBarbers')}</Link>
    {barber ? <MyAvailability targetBarber={barber} /> : <p role="alert">{t('barbers.barberNotFound')}</p>}</>;
}
