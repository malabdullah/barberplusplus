import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

export default function SubscriptionInvoices({ business, allowPdfDownload, date, money }) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState(false);

  async function download(invoice) {
    setDownloading(invoice.id);
    setError(false);
    try {
      const { downloadSubscriptionInvoice } = await import('../../utils/subscriptionInvoicePdf');
      await downloadSubscriptionInvoice({
        invoice, businessName: business.name,
        language: t('subscriptionInvoice.language'),
        labels: t('subscriptionInvoice', { returnObjects: true }),
      });
    } catch {
      setError(true);
    } finally {
      setDownloading(null);
    }
  }

  if (!business.invoices.length) return <p className="subscription-empty">{t('subscriptionFoundation.noInvoices')}</p>;

  return <>
    <ul className={`manager-billing-invoices${allowPdfDownload ? ' manager-billing-invoices-downloadable' : ''}`}>
      {business.invoices.map(invoice => <li key={invoice.id}>
        <span><time dateTime={invoice.created_at}>{date(invoice.created_at)}</time> · <bdi>{money(invoice.total_fils)}</bdi> · {t(`subscriptionInvoice.${invoice.state}`)}</span>
        {allowPdfDownload && <button type="button" className="billing-text-button" disabled={downloading !== null}
          onClick={() => download(invoice)} aria-busy={downloading === invoice.id}>
          <Download size={16} aria-hidden="true"/>{t('subscriptionInvoice.download')}
        </button>}
      </li>)}
    </ul>
    {error && <p className="subscription-error" role="alert">{t('subscriptionInvoice.downloadFailed')}</p>}
  </>;
}
