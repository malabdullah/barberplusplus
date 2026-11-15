import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { returnAppleDeletion } from '../services/customerAppleDeletion.service';

export default function CustomerAppleDeletionReturn() {
  const { t } = useTranslation(); const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    returnAppleDeletion(window.location.href);
  }, []);
  return <CustomerAuthLayout title={t('customerDeletion.appleTitle')} backTo="/customer/delete-account" backLabel={t('common.back')}>
    <p role="status">{t('customerDeletion.appleReturn')}</p>
  </CustomerAuthLayout>;
}
