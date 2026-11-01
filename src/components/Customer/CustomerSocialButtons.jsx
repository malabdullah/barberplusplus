import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { customerAuthService } from '../../services/customerAuth.service';

export default function CustomerSocialButtons({ returnTo, disabled, authService = customerAuthService, hint, hideDivider = false, hideUnavailable = false }) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState({ google: false, apple: false });
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    authService.socialProviders().then(value => { if (active) setProviders(value); }).catch(() => {}).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [authService]);
  const signIn = async provider => {
    if (busy) return;
    setBusy(true); setError('');
    try { await authService.startSocial(provider, returnTo); }
    catch { setError(t('customerAuth.errors.SOCIAL_SIGN_IN_FAILED')); setBusy(false); }
  };
  return <div className="ca-social">
    <div className="ca-social-buttons">{['google', 'apple'].map(provider => <button key={provider} type="button" className={`cb-secondary ca-social-${provider}`} disabled={disabled || busy || !providers[provider]} onClick={() => signIn(provider)}>{provider === 'apple' ? <svg className="ca-social-logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" /></svg> : <span className="ca-social-logo ca-social-logo-google" aria-hidden="true" />}{t(`customerAuth.social.${provider}`)}</button>)}</div>
    {!hideUnavailable && !checking && !providers.google && !providers.apple && <p className="cb-helper">{t('customerAuth.social.unavailable')}</p>}
    {error && <p className="cb-alert" role="alert">{error}</p>}
    {hint && <p className="cb-helper ca-provider-hint">{hint}</p>}
    {!hideDivider && <p className="ca-social-divider">{t('customerAuth.email.orEmail')}</p>}
  </div>;
}
