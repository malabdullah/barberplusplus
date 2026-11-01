import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { teamAuthService } from '../../services/teamAuth.service';
import CustomerSocialButtons from './CustomerSocialButtons';
import '../../pages/CustomerBooking.css';
import '../../pages/CustomerAuth.css';

export default function ManagerSocialAccounts() {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    teamAuthService.connectedProviders().then(value => { if (active) setConnected(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const connector = {
    socialProviders: async () => { const available = await teamAuthService.socialProviders(); return { google: available.google && !connected?.google, apple: available.apple && !connected?.apple }; },
    startSocial: provider => teamAuthService.connectProvider(provider),
  };
  return <div className="customer-booking ca-manager-social">
    <p className="cb-helper">{t('teamAuth.connectIntro')}</p>
    {error ? <p className="cb-alert" role="alert">{t('teamAuth.failed')}</p> : !connected ? <p role="status">{t('customerAuth.loading')}</p> : <>
      {(connected.google || connected.apple) && <p className="ca-notice" role="status">{t('teamAuth.connected', { providers: [connected.google && 'Google', connected.apple && 'Apple'].filter(Boolean).join(' · ') })}</p>}
      {(!connected.google || !connected.apple) && <CustomerSocialButtons authService={connector} disabled={false} hideDivider hideUnavailable />}
    </>}
  </div>;
}
