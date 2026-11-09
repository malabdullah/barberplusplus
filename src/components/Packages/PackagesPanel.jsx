import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { packagesService } from '../../services/packages.service';
import { packageError } from '../../utils/servicePackages';
import { addBookingDays, getKuwaitDate } from '../../utils/customerBooking';
import { packageEndDate } from '../../utils/servicePackages';
import ServicePicker from '../Forms/ServicePicker';
import './Packages.css';

function PackageDialog({ target, services, shop, onClose, onSaved }) {
  const { t } = useTranslation();
  const dialog = useRef(null);
  const titleId = useId();
  const { mode, item, offer } = target;
  const today = getKuwaitDate();
  const start = mode === 'republish' ? (offer?.ends_on >= today ? addBookingDays(offer.ends_on, 1) : today) : offer?.starts_on || today;
  const [data, setData] = useState({ name: item?.name || '', name_ar: item?.name_ar || '', service_ids: offer?.service_ids || item?.service_ids || [], price: offer?.price ?? '', starts_on: start, ends_on: mode === 'republish' ? packageEndDate(start, 'week') : offer?.ends_on || packageEndDate(start, 'week') });
  const [period, setPeriod] = useState(mode === 'create' || mode === 'republish' ? 'week' : 'custom');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const patch = values => setData(current => ({ ...current, ...values }));
  const chosen = services.filter(service => data.service_ids.includes(service.id));
  const regular = chosen.reduce((sum, service) => sum + Number(service.price), 0);
  const minutes = chosen.reduce((sum, service) => sum + service.duration, 0);
  const tr = key => t(`packages.${key}`);
  useEffect(() => { dialog.current.showModal(); }, []);
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    if (mode !== 'extend' && (chosen.length < 2 || chosen.length > 10 || minutes > 480 || Number(data.price) <= 0 || Number(data.price) > regular)) { setError(t('packages.errors.INVALID_PACKAGE')); return; }
    setBusy(true); setError('');
    try {
      await packagesService.manage(mode === 'create' || mode === 'edit' ? 'save' : mode, shop, { ...data, id: item?.id, offer_id: mode === 'republish' ? undefined : offer?.id });
      onSaved();
    } catch (failure) { setError(packageError(failure, t)); }
    finally { setBusy(false); }
  }
  return <dialog className="package-dialog" ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="package-dialog-heading"><h2 id={titleId}>{tr(mode)}</h2><button type="button" className="btn btn-ghost" aria-label={t('common.close')} disabled={busy} onClick={onClose}><X size={20} /></button></div>
    <form className="form" onSubmit={save}>
      {error && <p className="form-error-banner" role="alert">{error}</p>}
      {mode !== 'extend' && <>
        <div className="form-row"><div className="form-group"><label className="form-label" htmlFor="package-name">{tr('name')}</label><input className="form-input" id="package-name" required maxLength={120} value={data.name} onChange={e => patch({ name: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="package-name-ar">{tr('nameAr')}</label><input className="form-input" id="package-name-ar" dir="rtl" maxLength={120} value={data.name_ar} onChange={e => patch({ name_ar: e.target.value })} /></div></div>
        <ServicePicker label={t('services.title')} services={services.filter(service => service.status !== 'inactive' || data.service_ids.includes(service.id))} selectedIds={data.service_ids} disabled={busy}
          isOptionDisabled={service => !data.service_ids.includes(service.id) && data.service_ids.length >= 10}
          onToggle={id => patch({ service_ids: data.service_ids.includes(id) ? data.service_ids.filter(value => value !== id) : [...data.service_ids, id] })} />
        <div className="package-form-summary"><span>{minutes} {t('common.min')}</span><span>{tr('regularPrice')}: {regular.toFixed(3)} {t('common.currency')}</span></div>
        <div className="form-group"><label className="form-label" htmlFor="package-price">{tr('price')}</label><input className="form-input" id="package-price" type="number" required step="0.001" min="0.001" max={regular || 10000} value={data.price} onChange={e => patch({ price: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="package-period">{tr('validity')}</label><select className="form-input" id="package-period" value={period} onChange={e => { setPeriod(e.target.value); if (e.target.value !== 'custom') patch({ ends_on: packageEndDate(data.starts_on, e.target.value) }); }}>
          <option value="custom">{tr('custom')}</option><option value="week">{tr('week')}</option><option value="month">{tr('month')}</option></select></div>
      </>}
      {mode === 'extend' && <p>{item.name} · {tr('endsOn')}: {offer.ends_on}</p>}
      <div className="form-row">{mode !== 'extend' && <div className="form-group"><label className="form-label" htmlFor="package-start">{tr('startsOn')}</label><input className="form-input" id="package-start" type="date" required min={mode === 'edit' ? undefined : today} value={data.starts_on} onChange={e => patch({ starts_on: e.target.value, ...(period !== 'custom' ? { ends_on: packageEndDate(e.target.value, period) } : {}) })} /></div>}
        <div className="form-group"><label className="form-label" htmlFor="package-end">{tr('endsOn')}</label><input className="form-input" id="package-end" type="date" required min={mode === 'extend' ? addBookingDays(offer.ends_on, 1) : data.starts_on} value={data.ends_on} onChange={e => { setPeriod('custom'); patch({ ends_on: e.target.value }); }} /></div></div>
      <div className="form-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : tr(mode === 'extend' ? 'extend' : mode === 'republish' ? 'republish' : 'save')}</button></div>
    </form>
  </dialog>;
}

export default function PackagesPanel({ shop, services }) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState(null);
  const tr = key => t(`packages.${key}`);
  useEffect(() => {
    if (!shop) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => packagesService.list(shop, page, search).then(data => { if (active) setResult(data); }).catch(failure => { if (active) setError(packageError(failure, t)); }).finally(() => { if (active) setLoading(false); }), 200);
    return () => { active = false; clearTimeout(timer); };
  }, [shop, page, search, reload, t]);
  async function action(mode, item, offer) {
    if (busy) return;
    if (mode === 'archive' && !window.confirm(t('packages.archiveConfirm', { name: item.name }))) return;
    setBusy(true); setError('');
    try { await packagesService.manage(mode, shop, { id: item.id, offer_id: offer?.id }); setReload(value => value + 1); }
    catch (failure) { setError(packageError(failure, t)); }
    finally { setBusy(false); }
  }
  const today = getKuwaitDate();
  const date = value => new Intl.DateTimeFormat(i18n.language.startsWith('ar') ? 'ar-KW' : 'en-KW', { dateStyle: 'medium', timeZone: 'Asia/Kuwait' }).format(new Date(`${value}T12:00:00Z`));
  return <section className="packages-panel" aria-label={tr('title')}>
    <div className="services-toolbar"><input className="form-input" type="search" aria-label={tr('search')} placeholder={tr('search')} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /><button className="btn btn-primary" disabled={!shop} onClick={() => setTarget({ mode: 'create' })}><Plus size={18} />{tr('create')}</button></div>
    {error && <p className="form-error-banner" role="alert">{error}</p>}
    {loading ? <p role="status">{t('common.loading')}</p> : <div className="package-list">{result.items.map(item => {
      const offer = item.offers.find(o => o.starts_on <= today && o.ends_on >= today) || item.offers[0];
      return <article className="package-row" key={item.id}><div><h3>{(i18n.language.startsWith('ar') && item.name_ar) || item.name}</h3>
        <p>{item.service_ids.map(id => services.find(s => s.id === id)?.name).filter(Boolean).join(' + ')}</p>
        {item.offers.map(period => <div className="package-offer" key={period.id}><span className="package-offer-state">{tr(period.state)}</span><span>{date(period.starts_on)} – {date(period.ends_on)}</span><strong>{Number(period.price).toFixed(3)} {t('common.currency')}</strong><span>{period.duration} {t('common.min')}</span>
          {!item.archived && <div className="package-actions"><button className="btn btn-ghost" disabled={busy} onClick={() => setTarget({ mode: 'extend', item, offer: period })}>{tr('extend')}</button><button className="btn btn-ghost" disabled={busy} onClick={() => action(period.paused ? 'resume' : 'pause', item, period)}>{tr(period.paused ? 'resume' : 'pause')}</button></div>}</div>)}
      </div><div className="package-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => setTarget({ mode: 'edit', item, offer })}>{t('common.edit')}</button><button className="btn btn-secondary" disabled={busy} onClick={() => setTarget({ mode: 'republish', item, offer: item.offers[0] })}>{tr('republish')}</button>{!item.archived && <button className="btn btn-ghost" disabled={busy} onClick={() => action('archive', item)}>{tr('archive')}</button>}</div></article>;
    })}{!result.items.length && <p className="empty-state">{tr('empty')}</p>}</div>}
    {result.total > 20 && <nav className="package-pagination" aria-label={tr('pagination')}><button className="btn btn-secondary" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}>{tr('previous')}</button><span>{page + 1} / {Math.ceil(result.total / 20)}</span><button className="btn btn-secondary" disabled={loading || (page + 1) * 20 >= result.total} onClick={() => setPage(p => p + 1)}>{tr('next')}</button></nav>}
    {target && <PackageDialog target={target} services={services} shop={shop} onClose={() => setTarget(null)} onSaved={() => { setTarget(null); setReload(value => value + 1); }} />}
  </section>;
}
