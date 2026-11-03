import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminService } from '../../services/admin.service';

const transferErrors = {
  TRANSFER_FORBIDDEN: 'forbidden',
  TRANSFER_STALE: 'stale',
  TRANSFER_BARBER_INELIGIBLE: 'ineligible',
  TRANSFER_UPCOMING_APPOINTMENTS: 'upcomingChanged',
  TRANSFER_CHAIR_INACTIVE: 'inactive',
  TRANSFER_CONTACT_MISMATCH: 'contactMismatch',
  CHAIR_SERVICES_REQUIRED: 'servicesRequired',
  CHAIR_HOURS_REQUIRED: 'hoursRequired',
  'Role change blocked by password reset guard': 'passwordReset',
};

export default function BranchManagerTransfer({ barber, onTransferred, onBusyChange }) {
  const { t } = useTranslation();
  const [review, setReview] = useState(null);
  const [keepBookable, setKeepBookable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (choice = null) => {
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const result = await adminService.transferBranchManager(barber, choice);
      if (choice === null) {
        setReview(result);
        setKeepBookable(result.currentlyBookable);
      } else {
        onTransferred(review);
      }
    } catch (failure) {
      const code = transferErrors[failure.message] || 'unavailable';
      setError(t(`admin.managerTransfer.errors.${code}`));
      if (code === 'upcomingChanged') setReview(null);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <section className="admin-details-section admin-transfer">
      <h4>{t('admin.managerTransfer.title')}</h4>
      {error && <p role="alert" className="admin-transfer-alert">{error}</p>}
      {!review ? (
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => run()}>
          {t('admin.managerTransfer.review')}
        </button>
      ) : (
        <>
          <p>{t('admin.managerTransfer.summary', review)}</p>
          <p>{t('admin.managerTransfer.remaining', { count: review.remainingBranches })}</p>
          {review.outgoingUpcoming > 0 ? (
            <>
              <p role="alert" className="admin-transfer-alert">
                {t('admin.managerTransfer.upcoming', { count: review.outgoingUpcoming })}
              </p>
              <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => run()}>
                {t('admin.managerTransfer.refresh')}
              </button>
            </>
          ) : (
            <>
              <fieldset className="admin-transfer-options" disabled={busy}>
                <legend>{t('admin.managerTransfer.chair')}</legend>
                <label>
                  <input type="radio" name="transfer-chair" checked={keepBookable}
                    disabled={!review.currentlyBookable} onChange={() => setKeepBookable(true)} />
                  {t('admin.managerTransfer.keepBookable')}
                </label>
                <label>
                  <input type="radio" name="transfer-chair" checked={!keepBookable}
                    onChange={() => setKeepBookable(false)} />
                  {t('admin.managerTransfer.managerOnly')}
                </label>
              </fieldset>
              <p>{t('admin.managerTransfer.preserved')}</p>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run(keepBookable)}>
                {t('admin.managerTransfer.confirm')}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
