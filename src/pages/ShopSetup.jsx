import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ArrowRight, RefreshCw, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import BranchForm from '../components/Forms/BranchForm';
import ServiceForm from '../components/Forms/ServiceForm';
import InviteBarberForm from '../components/Invitations/InviteBarberForm';
import PendingInvitations from '../components/Invitations/PendingInvitations';
import { shopSetupService } from '../services/shopSetup.service';
import { getErrorMessage } from '../utils/errorMessages';
import { getShopSetup, isSetupId, SETUP_STEPS, shopSetupUrl, setupActionUrl } from '../utils/shopSetup';
import './ShopSetup.css';

export default function ShopSetup() {
  const { t, i18n } = useTranslation(); const tr = (key, options) => t('shopSetup.' + key, options);
  const { user, branches, selectedBranchId, setSelectedBranchId, addBranch, updateBranch, managerChair, reloadData, addService, updateService } = useApp();
  const [params] = useSearchParams(); const navigate = useNavigate(); const location = useLocation();
  const owned = branches.filter(shop => shop.managerId === user?.id);
  const id = params.get('shop') || (owned.some(shop => shop.id === selectedBranchId) ? selectedBranchId : owned[0]?.id) || 'new';
  const creating = id === 'new'; const permitted = creating || isSetupId(id) && owned.some(shop => shop.id === id);
  const [snapshot, setSnapshot] = useState(null); const [loading, setLoading] = useState(!creating);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0); const [editor, setEditor] = useState(); const [inviteOpen, setInviteOpen] = useState(false);
  const currentId = useRef(id); currentId.current = id; const heading = useRef(null);
  const progress = getShopSetup(snapshot?.shop, snapshot?.services, snapshot?.barbers);
  const step = creating ? 'shop' : SETUP_STEPS.includes(params.get('step')) ? params.get('step') : progress.next;
  const shop = snapshot?.shop;
  const items = step === 'services' ? progress.services : progress.barbers;
  const pageCount = Math.max(1, Math.ceil(items.length / 8));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleServices = progress.services.slice(currentPage * 8, currentPage * 8 + 8);
  const visibleBarbers = progress.barbers.slice(currentPage * 8, currentPage * 8 + 8);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    setSnapshot(null); setError(''); setNotice(''); setEditor(undefined); setInviteOpen(false); setBusy(false);
    if (!creating && permitted) setSelectedBranchId(id);
  }, [id, creating, permitted, setSelectedBranchId]);
  useEffect(() => {
    if (creating || !permitted) { setLoading(false); return undefined; }
    let active = true; setLoading(true); setError('');
    shopSetupService.get(id, user?.id).then(async value => { if (active) { await reloadData(); if (active) setSnapshot(value); } })
      .catch(() => { if (active) setError(tr('loadFailed')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // Translation changes do not refetch shop data or reset in-progress fields.
  }, [id, creating, permitted, revision, user?.id, reloadData]);
  useEffect(() => {
    const focus = () => { if (document.visibilityState === 'visible' && !busy && step !== 'shop' && editor === undefined && !inviteOpen) reload(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [reload, busy, step, editor, inviteOpen]);
  useEffect(() => {
    if (snapshot && (!params.has('shop') || !SETUP_STEPS.includes(params.get('step')))) navigate(shopSetupUrl(id, progress.next), { replace: true });
  }, [snapshot, id, navigate, params, progress.next]);
  useEffect(() => { setPage(0); setError(''); setNotice(''); heading.current?.focus({ preventScroll: true }); }, [step]);
  const go = next => navigate(shopSetupUrl(id, next));
  const saveShop = async data => {
    if (busy) return; const scope = id; setBusy(true); setError('');
    try {
      if (creating) {
        const created = await addBranch(data);
        if (currentId.current === scope) { navigate(shopSetupUrl(created.id, 'services'), { state: { imageWarning: created.imageWarning } }); }
      } else {
        await updateBranch(id, data);
        if (currentId.current === scope) { reload(); go('services'); }
      }
    } catch (failure) { if (currentId.current === scope) setError(getErrorMessage(failure, tr('saveFailed'), t)); }
    finally { if (currentId.current === scope) setBusy(false); }
  };
  const saveService = async data => {
    if (busy || !shop) return; const scope = id; setBusy(true); setError('');
    try {
      if (selectedBranchId !== id) throw new Error('SHOP_REQUIRED');
      const saved = editor?.id ? await updateService(editor.id, data) : await addService({ ...data, branchId: id });
      if (currentId.current === scope) { setSnapshot(previous => ({ ...previous, services: editor?.id ? previous.services.map(service => service.id === saved.id ? saved : service) : [...previous.services, saved] })); setEditor(undefined); void reloadData(); }
    } catch (failure) { if (currentId.current === scope) setError(getErrorMessage(failure, tr('saveFailed'), t)); }
    finally { if (currentId.current === scope) setBusy(false); }
  };
  const editMember = (barber, returnStep = 'team') => setupActionUrl(barber.managerChair ? '/dashboard/my-chair?view=profile' : '/dashboard/barbers/' + barber.id + '/edit', id, returnStep);
  const reviewMember = barber => setupActionUrl(barber.managerChair ? '/dashboard/my-chair?view=hours' : '/dashboard/availability-requests?barber=' + barber.id, id, 'hours');
  const memberName = barber => i18n.language === 'ar' && barber.nameAr || barber.name;
  const pager = items.length > 8 && <nav className="setup-pagination" aria-label={tr('pages')}><button type="button" className="btn btn-secondary" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('common.previous')}</button><span>{tr('page', { page: currentPage + 1, count: pageCount })}</span><button type="button" className="btn btn-secondary" disabled={busy || currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>{t('common.next')}</button></nav>;
  const continueButton = (next, enabled = true) => <button type="button" className="btn btn-primary" disabled={busy || loading || Boolean(error) || !enabled} onClick={() => go(next)}>{tr('continue')}<ArrowRight size={17} aria-hidden="true" /></button>;
  if (!permitted) return <div className="shop-setup"><h1>{tr('title')}</h1><p role="alert">{tr('notFound')}</p><Link className="btn btn-secondary" to="/dashboard/setup">{tr('chooseShop')}</Link></div>;
  return <div className="shop-setup">
    <header className="setup-header"><div><h1>{tr('title')}</h1><p>{shop ? i18n.language === 'ar' && shop.nameAr || shop.name : tr('newShop')}</p></div><div className="setup-header-actions">
      {!creating && <Link className="btn btn-secondary" to="/dashboard/setup?shop=new"><Plus size={17} aria-hidden="true" />{tr('newShop')}</Link>}
      {!creating && <button type="button" className="btn btn-secondary" onClick={reload} disabled={busy || loading}><RefreshCw size={17} aria-hidden="true" />{t('common.refresh')}</button>}
      <Link className="btn btn-ghost" to="/dashboard">{tr('exit')}</Link>
    </div></header>
    <div className="setup-progress"><label htmlFor="shop-setup-progress">{tr('progress', { count: progress.completed })}</label><progress id="shop-setup-progress" max="4" value={progress.completed} /></div>
    <div className="setup-layout"><nav className="setup-steps" aria-label={tr('steps')}><ol>{SETUP_STEPS.map((name, index) => <li key={name}>
      <button type="button" disabled={busy || creating && name !== 'shop'} aria-current={step === name ? 'step' : undefined} onClick={() => go(name)}>
        <span className={'setup-step-number' + (progress.complete[name] ? ' is-done' : '')}>{progress.complete[name] ? <Check size={17} aria-label={tr('done')} /> : index + 1}</span><span>{tr('stepsLabels.' + name)}</span>
      </button></li>)}</ol></nav>
      <section className="setup-panel" aria-labelledby="setup-step-title" aria-busy={loading || busy}>
        <h2 id="setup-step-title" ref={heading} tabIndex="-1">{tr('stepsLabels.' + step)}</h2>
        {error && <p className="error-banner" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {location.state?.imageWarning && <p role="alert">{t('managerAudit.imageWarning')}</p>}
        {loading && !snapshot && <p role="status">{t('common.loading')}</p>}
        {!creating && !snapshot && !loading && <button className="btn btn-secondary" onClick={reload}>{t('common.retry')}</button>}
        {(creating || snapshot?.shop.id === id) && <>
          {step === 'shop' && <BranchForm key={id} branch={shop || null} onSubmit={saveShop} onCancel={() => navigate('/dashboard')} isSubmitting={busy || loading} submitText={tr('saveContinue')} />}
          {step === 'services' && <>
            <div className="setup-service-list">{visibleServices.map(service => <div className="setup-row" key={service.id}><div><strong>{service.name}</strong><span>{service.duration} {t('common.min')} · {service.price.toFixed(3)} {t('common.currency')}</span></div><button className="btn btn-ghost" disabled={busy} onClick={() => setEditor(service)}>{t('common.edit')}</button></div>)}</div>
            {pager}
            {editor || !progress.services.length ? <ServiceForm key={editor?.id || id + '-new'} service={editor?.id ? editor : null} onSubmit={saveService} onCancel={() => setEditor(undefined)} isSubmitting={busy} /> : <button className="btn btn-secondary" onClick={() => setEditor({})}><Plus size={17} aria-hidden="true" />{t('services.addService')}</button>}
            <div className="setup-footer">{continueButton('team', progress.complete.services)}</div>
          </>}
          {step === 'team' && <>
            <div className="setup-team">{visibleBarbers.map(barber => <div className="setup-row" key={barber.id}><div><strong>{memberName(barber)}</strong><span>{tr(progress.assigned(barber) ? 'servicesAssigned' : 'assignServices')}</span></div><Link className="btn btn-secondary" to={editMember(barber)}>{tr('assignServices')}</Link></div>)}</div>
            {pager}
            {inviteOpen ? <div className="setup-invite"><h3>{t('barberInvitations.invite')}</h3><InviteBarberForm branch={shop} onSent={result => { setNotice(t('barberInvitations.' + (result.delivered ? 'sent' : 'deliveryFailed'))); setInviteOpen(false); reload(); }} /></div> : <button className="btn btn-primary" onClick={() => setInviteOpen(true)}><Plus size={17} aria-hidden="true" />{t('barberInvitations.invite')}</button>}
            {(!managerChair || managerChair.branchId === id) && <Link className="btn btn-ghost setup-chair" to={setupActionUrl('/dashboard/my-chair?view=profile', id, 'team')}>{tr('myChair')}</Link>}
            <PendingInvitations branchId={id} reloadKey={revision} />
            <div className="setup-footer">{continueButton('hours', progress.complete.team)}</div>
          </>}
          {step === 'hours' && <>
            {!progress.barbers.length && <Link className="btn btn-primary" to={shopSetupUrl(id, 'team')}>{t('barberInvitations.invite')}</Link>}
            {visibleBarbers.map(barber => <div className="setup-row" key={barber.id}><div><strong>{memberName(barber)}</strong><span>{tr(progress.hours(barber) ? 'hoursApproved' : 'hoursNeeded')}</span>{barber.status !== 'active' && <span>{tr('inactiveBarber')}</span>}</div><div className="setup-row-actions"><Link className="btn btn-secondary" to={reviewMember(barber)}>{tr(barber.managerChair ? 'setHours' : 'reviewRequests')}</Link>{barber.status !== 'active' && <Link className="btn btn-ghost" to={editMember(barber, 'hours')}>{tr('activateBarber')}</Link>}</div></div>)}
            {pager}
            <div className="setup-footer">{continueButton('review')}</div>
          </>}
          {step === 'review' && <>
            <div className={'setup-readiness' + (progress.ready ? ' is-ready' : '')}><strong>{tr(progress.ready ? 'ready' : 'unfinished')}</strong><span>{tr('readyBarbers', { count: progress.readyBarbers.length })}</span></div>
            <div className="setup-review">{SETUP_STEPS.filter(name => name !== 'review').map(name => <div className="setup-row" key={name}><div><strong>{tr('stepsLabels.' + name)}</strong><span>{tr(progress.complete[name] ? 'done' : 'needed')}</span></div><button className="btn btn-secondary" onClick={() => go(name)}>{tr(progress.complete[name] ? 'edit' : 'finish')}</button></div>)}</div>
            <div className="setup-footer">{!progress.ready && continueButton(progress.next)}<Link className="btn btn-secondary" to={'/dashboard/branches/' + id}>{tr('viewShop')}</Link></div>
          </>}
        </>}
      </section>
    </div>
  </div>;
}
