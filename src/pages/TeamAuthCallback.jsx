import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { teamAuthService } from '../services/teamAuth.service';
export default function TeamAuthCallback() {
  const { t } = useTranslation(); const navigate = useNavigate(); const callback = useRef(null); const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    callback.current ||= teamAuthService.finishSocial(window.location.href);
    callback.current.then(destination => { if (active) navigate(destination, { replace: true }); }).catch(failure => { if (active) setError(failure.linking ? 'connectionFailed' : failure.message === 'MANAGER_REQUIRED' ? 'managerRequired' : 'failed'); });
    return () => { active = false; };
  }, []);
  return <CustomerAuthLayout accountType="team" title={t(error === 'connectionFailed' ? 'teamAuth.connectionTitle' : 'teamAuth.callbackTitle')}><div className="ca-result">
    {error ? <><p className="cb-alert" role="alert">{t(`teamAuth.${error}`)}</p><Link className="cb-primary ca-submit" to={error === 'connectionFailed' ? '/dashboard/settings' : '/login'}>{t(error === 'connectionFailed' ? 'teamAuth.backSettings' : 'teamAuth.backLogin')}</Link><Link className="cb-text-button" to="/customer/sign-in">{t('publicNav.customerSignIn')}</Link></> : <p className="ca-loading" role="status"><Loader2 className="cb-spinner" size={24} aria-hidden="true" />{t('customerAuth.loading')}</p>}
  </div></CustomerAuthLayout>;
}
