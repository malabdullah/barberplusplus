import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Plus, RefreshCw, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { settlementRpc } from '../services/settlements.service';
import { exportSettlement } from '../services/settlementExport.service';
import { settlementAmount, settlementDate, settlementNow, settlementPercent } from '../utils/settlementFormatting';
import { financeToday } from '../utils/financeFormatting';
import { localizedReportName, reportDate, reportMoney } from '../utils/reportFormatting';
import './Reports.css';
import './Settlements.css';

const tabs = ['receipts', 'statements', 'payouts', 'history'];
const balanceDetails = ['recordedFils', 'balanceFils', 'commissionFils'];
const listColumns = {
  shops: ['shops', 'availableFils', 'reservedFils'],
  receipts: ['reference', 'amountFils', 'commissionFils', 'netFils', 'state', 'actions'],
  statements: ['period', 'state', 'outstandingFils', 'actions'],
  payouts: ['date', 'amountFils', 'state', 'payeeName', 'reference', 'actions'],
  history: ['date', 'action', 'reason'],
};
const reasonActions = ['save-policy', 'save-beneficiary', 'record-refund', 'hold', 'release-hold', 'reverse-event', 'uncertain-payout', 'fail-payout', 'cancel-payout', 'cancel-statement'];
export default function Settlements({ admin = false }) {
  const { t, i18n } = useTranslation();
  const { user } = useApp();
  const label = key => t(`settlements.${key}`);
  const money = value => <bdi>{reportMoney(value || '0', i18n.language)}</bdi>;
  const month = value => new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric', timeZone: 'Asia/Kuwait' }).format(new Date(value));
  const [shop, setShop] = useState(null);
  const [rows, setRows] = useState([]);
  const [dataKey, setDataKey] = useState('');
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState('receipts');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const [details, setDetails] = useState(null);
  const [detailRows, setDetailRows] = useState([]);
  const [detailMore, setDetailMore] = useState(false);
  const [detailPage, setDetailPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const modal = useRef(null);
  const dialogTrigger = useRef(null);
  const shopListPosition = useRef(null);
  const restoreShopList = useRef(false);
  const sequence = useRef(0);
  const active = useRef(true);
  const identity = `${admin}:${user?.id}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const viewKey = `${identity}:${shop?.id || ''}:${tab}:${page}:${query}`;
  const retry = useRef(null);
  const exportAbort = useRef(null);
  const rpc = (action, data) => settlementRpc(admin, action, data);
  function fail(failure) {
    if (/FORBIDDEN|EXPIRED/.test(failure.message)) { setRows([]); setShop(null); setDialog(null); setDetails(null); exportAbort.current?.abort(); }
    setError(t(`settlements.errors.${failure.message}`, { defaultValue: label('errors.SETTLEMENT_FAILED') }));
  }
  useEffect(() => {
    active.current = true;
    shopListPosition.current = null; restoreShopList.current = false;
    setShop(null); setRows([]); setDialog(null); setDetails(null); setPage(0); setSaving(false); setExporting(false);
    return () => { active.current = false; sequence.current++; exportAbort.current?.abort(); };
  }, [user?.id, admin]);
  useEffect(() => {
    const current = ++sequence.current;
    // Keep the current rows mounted during a refresh so focus and clicks survive.
    setBusy(true); setError('');
    settlementRpc(admin, shop ? tab : 'shops', { ...(shop ? { shopId: shop.id } : {}), offset: page * 25, query }).then(value => {
      if (active.current && sequence.current === current) { setRows(value.rows.slice(0, 25)); setMore(value.hasMore); setDataKey(viewKey);
        if (shop) settlementRpc(admin, 'shops', { shopId: shop.id }).then(summary => { if (active.current && sequence.current === current && summary.rows[0]) setShop(summary.rows[0]); }).catch(failure => { if (active.current && sequence.current === current) fail(failure); }); }
    }).catch(failure => { if (active.current && sequence.current === current) fail(failure); }).finally(() => { if (active.current && sequence.current === current) setBusy(false); });
    return () => { sequence.current++; };
  }, [user?.id, admin, shop?.id, tab, page, query, refresh]);
  useEffect(() => {
    if (dialog) modal.current?.showModal();
    else { modal.current?.close(); dialogTrigger.current?.focus(); }
  }, [dialog]);
  useEffect(() => {
    if (!dialog) return undefined;
    let current = true;
    const kind = dialog.kind;
    const action = kind === 'settings' ? 'settings' : kind === 'record-receipt' ? 'bookings' : kind === 'statement' ? 'statement-rows' : kind === 'journal' ? 'journal' : null;
    if (!action) return undefined;
    setDetails(null); setDetailRows([]);
    const data = { shopId: dialog.shopId, id: dialog.row?.id, offset: detailPage * 25, after: detailPage * 25, limit: 25 };
    Promise.all([rpc(action, data), kind === 'statement' ? rpc('statement', data) : Promise.resolve(null)]).then(([value, statement]) => {
      if (!current) return;
      setDetails(kind === 'settings' ? value : statement);
      if (kind === 'settings') setForm(v => ({ ...v, useDefault: value.shopRate?.rateBps == null, rate: (dialog.global ? value.defaultRate?.rateBps : value.shopRate?.rateBps) == null ? '' : String((dialog.global ? value.defaultRate.rateBps : value.shopRate.rateBps) / 100), feeBearer: value.agreement?.feeBearer || 'shop' }));
      setDetailRows(value.rows?.slice(0, 25) || []); setDetailMore(value.hasMore || false);
    }).catch(failure => { if (current) fail(failure); });
    return () => { current = false; };
  }, [dialog, detailPage, admin, user?.id]);
  useEffect(() => {
    if (shop || dataKey !== viewKey || !restoreShopList.current) return;
    restoreShopList.current = false;
    const position = shopListPosition.current;
    document.getElementById(`settlement-shop-${position.id}`)?.focus({ preventScroll: true });
    if (document.scrollingElement) document.scrollingElement.scrollTop = position.scrollTop;
  }, [shop, dataKey, viewKey]);
  function selectShop(row) {
    shopListPosition.current = { id: row.id, page, query, search, scrollTop: document.scrollingElement?.scrollTop || 0 };
    setShop(row); setPage(0); setTab('receipts'); setQuery(''); setSearch('');
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  }
  function backToShops() {
    const position = shopListPosition.current;
    restoreShopList.current = Boolean(position);
    setShop(null); setPage(position?.page || 0); setQuery(position?.query || ''); setSearch(position?.search || '');
  }
  const changeTab = value => { setTab(value); setPage(0); setQuery(''); setSearch(''); };
  function open(kind, row = null, global = false) {
    dialogTrigger.current = document.activeElement;
    retry.current = null; setError(''); setNotice(''); setDetails(null); setDetailRows([]); setDetailPage(0);
    setForm({ amount: kind === 'confirm-payout' ? (Number(row.amountFils) / 1000).toFixed(3) : '', fee: '', rate: '', feeBearer: 'shop', useDefault: true, period: financeToday().slice(0, 7), date: settlementNow(), settled: false, reference: '', reason: '', payeeName: '', beneficiaryRef: '', ibanLastFour: '', bookingId: '', statementId: row?.id || '' });
    setDialog({ kind, row, shopId: global ? null : shop?.id, global });
  }
  const close = () => { if (!saving) { setDialog(null); setError(''); } };
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const owner = identityRef.current;
    let action = dialog.kind;
    const data = { ...(dialog.shopId ? { shopId: dialog.shopId } : {}), ...(dialog.row?.id ? { id: dialog.row.id } : {}), reason: form.reason };
    if (action === 'settings') action = 'save-policy';
    if (action === 'save-policy') {
      data.rateBps = dialog.global || !form.useDefault ? settlementPercent(form.rate) : null;
      if ((dialog.global || !form.useDefault) && data.rateBps === null) return setError(label('errors.SETTLEMENT_INVALID'));
      if (!dialog.global) data.feeBearer = form.feeBearer;
    }
    if (action === 'save-beneficiary') Object.assign(data, { payeeName: form.payeeName, beneficiaryRef: form.beneficiaryRef, ibanLastFour: form.ibanLastFour });
    if (['record-receipt', 'record-fee', 'record-refund', 'prepare-payout', 'confirm-payout'].includes(action)) {
      data.amountFils = settlementAmount(form.amount, { zero: action === 'record-fee', signed: action === 'record-fee' });
      if (data.amountFils === null) return setError(label('errors.SETTLEMENT_INVALID'));
      data.reference = form.reference;
    }
    if (action === 'record-receipt') {
      data.bookingId = form.bookingId; data.collectedAt = settlementDate(form.date);
      data.settledAt = form.settled ? data.collectedAt : null;
      data.feeFils = form.fee === '' ? null : settlementAmount(form.fee, { zero: true });
      if (form.fee !== '' && data.feeFils === null) return setError(label('errors.SETTLEMENT_INVALID'));
    }
    if (action === 'record-fee' || action === 'record-refund') data.occurredAt = settlementDate(form.date);
    if (action === 'settle-receipt') data.settledAt = settlementDate(form.date);
    if (action === 'prepare-statement') data.period = `${form.period}-01`;
    if (action === 'finalize-statement') data.fingerprint = dialog.row.fingerprint;
    if (action === 'prepare-payout') data.statementId = form.statementId;
    if (action === 'confirm-payout') data.transferredAt = settlementDate(form.date);
    if (action === 'reverse-event') { data.id = dialog.row.receiptId; data.eventId = dialog.row.id; }
    const signature = JSON.stringify({ action, data });
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    setSaving(true); setError('');
    try {
      const result = await rpc(action, { ...data, requestId: retry.current.requestId });
      if (!active.current || identityRef.current !== owner) return;
      setDialog(null); setNotice(label('saved')); setRefresh(v => v + 1);
      if (action === 'prepare-statement') {
        const statement = await rpc('statement', { id: result.id, shopId: dialog.shopId });
        if (active.current && identityRef.current === owner) open('statement', statement);
      }
    } catch (failure) { if (active.current && identityRef.current === owner) fail(failure); }
    finally { if (active.current && identityRef.current === owner) setSaving(false); }
  }
  async function download(id) {
    const owner = identityRef.current;
    setExporting(true); setError(''); exportAbort.current = new AbortController();
    try {
      const blob = await exportSettlement(admin, id, t('settlements', { returnObjects: true }), i18n.language, exportAbort.current.signal);
      if (!active.current || identityRef.current !== owner || exportAbort.current.signal.aborted) return;
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `Barber-settlement-${id}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { if (active.current && identityRef.current === owner && failure.name !== 'AbortError') fail(failure); }
    finally { if (active.current && identityRef.current === owner) setExporting(false); }
  }
  const field = (key, type = 'text', required = true, extra = {}) => <label key={key}>{label(key === 'fee' ? 'feeAmount' : key)}<input type={type} value={form[key]} onChange={e => setForm(v => ({ ...v, [key]: e.target.value }))} required={required} {...extra} /></label>;
  const button = (kind, row, text = kind) => <button key={kind} type="button" className="report-text-action" onClick={() => open(kind, row)}>{label(text)}</button>;
  const pagination = (value, setValue, hasMore) => (value > 0 || hasMore) && <nav className="settlement-pagination" aria-label={label('pagination')}><button className="btn btn-secondary" type="button" disabled={busy || value === 0} onClick={() => setValue(v => v - 1)} aria-label={label('previous')}><ChevronLeft size={18} /></button><span>{value + 1}</span><button className="btn btn-secondary" type="button" disabled={busy || !hasMore} onClick={() => setValue(v => v + 1)} aria-label={label('next')}><ChevronRight size={18} /></button></nav>;
  const readOnlyDialog = ['statement', 'journal'].includes(dialog?.kind);
  const action = dialog?.kind;
  const columns = listColumns[shop ? tab : 'shops'];
  const cell = (key, content) => <td data-label={label(key)}><div className="settlement-cell-value">{content}</div></td>;
  const moreActions = children => <details className="settlement-row-menu">
    <summary>{label('moreActions')}</summary><div>{children}</div>
  </details>;
  const receiptStatus = row => row.reversed ? 'reversed' : row.held ? 'held' : !row.settledAt ? 'unsettled'
    : !row.feeKnown ? 'unknownFee' : row.eligible ? 'eligible' : 'notCompleted';
  const hasStatement = action === 'statement' && details;
  const statementHasAdjustments = hasStatement && (String(details.totalFils) !== String(details.currentFils)
    || detailRows.some(row => String(row.snapshot.netFils) !== String(row.current.netFils)));
  const statementHasAllocations = hasStatement
    && detailRows.some(row => String(row.current.remainingFils) !== String(row.current.netFils));
  const statementColumns = [
    'bookingId', 'netFils', ...(statementHasAdjustments ? ['currentFils'] : []),
    ...(statementHasAllocations ? ['remainingFils'] : []),
  ];
  return <main className="reports-page settlement-page">
    <header className="reports-heading settlement-heading">
      <div>
        {shop && <button type="button" className="report-text-action settlement-back" onClick={backToShops}><ArrowLeft size={16} />{label('shops')}</button>}
        <div className="settlement-title-row"><h1>{label('title')}</h1>
          <button type="button" className="btn btn-secondary settlement-refresh" onClick={() => setRefresh(v => v + 1)} aria-label={label('refresh')} title={label('refresh')}><RefreshCw size={17} /></button>
        </div>
        {shop && <p className="settlement-shop-name">{localizedReportName(shop, i18n.language)}</p>}
      </div>
      <div className="settlement-actions">
        {admin && !shop && <Link to="/admin/settlements/reconciliation" className="btn btn-secondary">{label('reconciliation')}</Link>}
        {admin && (shop ? <details className="settlement-header-menu">
          <summary className="btn btn-secondary">{label('settingsAction')}</summary>
          <div>{button('settings', null)}{button('save-beneficiary')}</div>
        </details> : <details className="settlement-header-menu">
          <summary className="btn btn-secondary">{label('moreActions')}</summary>
          <div><button type="button" className="report-text-action" onClick={() => open('settings', null, true)}>{label('defaultRate')}</button></div>
        </details>)}
      </div>
    </header>
    {!shop && <p className="settlement-subtitle">{label(admin ? 'adminSubtitle' : 'managerSubtitle')}</p>}
    {!dialog && error && <p className="report-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {shop && <>
      <section className="settlement-balance" aria-label={label('balanceSummary')}>
        <div className="settlement-balance-main"><span>{label('availableFils')}</span><strong>{money(shop.availableFils)}</strong></div>
        <dl className="settlement-balance-side">
          <div><dt>{label('reservedFils')}</dt><dd>{money(shop.reservedFils)}</dd></div>
          <div><dt>{label('heldFils')}</dt><dd>{money(shop.heldFils)}</dd></div>
        </dl>
        <details className="settlement-breakdown">
          <summary>{label('balanceDetails')}</summary>
          <dl>{balanceDetails.map(key => <div key={key}><dt>{label(key)}</dt><dd>{money(shop[key])}</dd></div>)}</dl>
        </details>
      </section>
      <nav className="settlement-tabs" aria-label={label('title')}>{tabs.map(key =>
        <button type="button" className={tab === key ? 'active' : ''} key={key} onClick={() => changeTab(key)} aria-current={tab === key ? 'page' : undefined}>{label(key)}</button>
      )}</nav>
    </>}
    {(!shop || tab === 'receipts' || admin && tab === 'statements') && <div className="settlement-toolbar">
      {(!shop || tab === 'receipts') && <form onSubmit={event => { event.preventDefault(); setQuery(search); setPage(0); }}>
        <label className="settlement-sr-only" htmlFor="settlement-search">{label('search')}</label>
        <input id="settlement-search" value={search} onChange={e => setSearch(e.target.value)} placeholder={label(shop ? 'searchReceipts' : 'searchShops')} maxLength={100} />
        <button type="submit" className="btn btn-secondary">{label('search')}</button>
      </form>}
      {shop && admin && <button type="button" className="btn btn-primary" onClick={() => open(tab === 'receipts' ? 'record-receipt' : 'prepare-statement')}>
        <Plus size={17} />{label(tab === 'receipts' ? 'record-receipt' : 'prepare-statement')}
      </button>}
    </div>}
    {dataKey !== viewKey ? (busy || !error ? <p className="report-state" role="status">{label('loading')}</p> : null) : !rows.length
      ? <p className="report-state">{label('empty')}</p>
      : <div className={`report-table-scroll settlement-list${!shop ? ' settlement-shop-list' : ''}`}><table><thead><tr>{columns.map(key => <th scope="col" key={key}>{label(key)}</th>)}</tr></thead><tbody>
        {rows.map(row => <tr key={row.id}>
          {!shop ? <>
            {cell('shops', <button id={`settlement-shop-${row.id}`} type="button" className="report-text-action settlement-shop-open" aria-label={localizedReportName(row, i18n.language)} aria-describedby={`settlement-balance-${row.id}`} onClick={() => selectShop(row)}>
              <span className="settlement-shop-label">{localizedReportName(row, i18n.language)}</span>
              <span id={`settlement-balance-${row.id}`} className="settlement-mobile-balance">
                <span>{label('availableFils')}</span><strong>{money(row.availableFils)}</strong>
                {Number(row.reservedFils) !== 0 && <span className="settlement-mobile-reserved">{label('reservedFils')} · {money(row.reservedFils)}</span>}
              </span>
              <ChevronRight className="settlement-shop-chevron" size={18} aria-hidden="true" />
            </button>)}
            {cell('availableFils', money(row.availableFils))}
            {cell('reservedFils', money(row.reservedFils))}
          </> : tab === 'receipts' ? <>
            {cell('reference', <><bdi>{row.sourceRef}</bdi><small>{reportDate(row.collectedAt, i18n.language, true)} · {row.bookingDate} {row.bookingTime?.slice(0, 5)}</small></>)}
            {cell('amountFils', money(row.amountFils))}
            {cell('commissionFils', money(row.commissionFils))}
            {cell('netFils', <>{money(row.netFils)}{row.remainingFils !== row.netFils && <small>{label('remainingFils')} · {money(row.remainingFils)}</small>}</>)}
            {cell('state', label(receiptStatus(row)))}
            {cell('actions', <div className="settlement-row-actions">
              {button('journal', row)}
              {admin && !row.reversed && moreActions(<>
                {!row.settledAt && button('settle-receipt', row)}
                {button('record-fee', row)}{button('record-refund', row)}{button(row.held ? 'release-hold' : 'hold', row)}
              </>)}
            </div>)}
          </> : tab === 'statements' ? <>
            {cell('period', <time dateTime={row.period}>{month(row.period)}</time>)}
            {cell('state', label(row.state))}
            {cell('outstandingFils', money(row.outstandingFils))}
            {cell('actions', <button type="button" className="btn btn-secondary settlement-view" onClick={() => open('statement', row)}>{label('view')}</button>)}
          </> : tab === 'payouts' ? <>
            {cell('date', reportDate(row.transferredAt || row.createdAt, i18n.language, true))}
            {cell('amountFils', money(row.amountFils))}
            {cell('state', label(row.state))}
            {cell('payeeName', <>{row.payeeName}<small>•••• {row.ibanLastFour}</small></>)}
            {cell('reference', <>{row.bankRef || '—'}{admin && <small>{row.beneficiaryRef}</small>}</>)}
            {cell('actions', admin && ['prepared', 'uncertain'].includes(row.state)
              ? <div className="settlement-row-actions">
                {button('confirm-payout', row)}
                {row.state === 'prepared' ? moreActions(<>
                  {button('uncertain-payout', row)}{button('cancel-payout', row)}{button('fail-payout', row)}
                </>) : button('fail-payout', row)}
              </div> : '—')}
          </> : <>
            {cell('date', reportDate(row.createdAt, i18n.language, true))}
            {cell('action', label(row.action))}
            {cell('reason', row.details?.reason || '—')}
          </>}
        </tr>)}
      </tbody></table></div>}
    {pagination(page, setPage, more)}
    <dialog ref={modal} className="report-filter-dialog settlement-dialog" onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="settlement-dialog-title"><header><h2 id="settlement-dialog-title">{label(action || 'title')}</h2><button className="btn btn-secondary" onClick={close} disabled={saving} aria-label={label('close')}><X size={20} /></button></header>
      {dialog && <><form className="settlement-dialog-form" onSubmit={submit}><fieldset disabled={saving || (action === 'settings' && !details)}>
        {error && <p className="report-error" role="alert">{error}</p>}
        {action === 'settings' && <>{details && <dl><div><dt>{label('defaultRate')}</dt><dd>{details.defaultRate ? `${details.defaultRate.rateBps / 100}%` : label('unset')}</dd></div>{!dialog.global && <><div><dt>{label('shopRate')}</dt><dd>{details.shopRate?.rateBps != null ? `${details.shopRate.rateBps / 100}%` : label('useDefault')}</dd></div><div><dt>{label('feeBearer')}</dt><dd>{details.agreement ? label(details.agreement.feeBearer) : label('unset')}</dd></div></>}</dl>}{!dialog.global && <label className="settlement-checkbox"><input type="checkbox" checked={form.useDefault} onChange={e => setForm(v => ({ ...v, useDefault: e.target.checked }))} />{label('useDefault')}</label>}{(dialog.global || !form.useDefault) && field('rate', 'text', true, { inputMode: 'decimal' })}{!dialog.global && <label>{label('feeBearer')}<select value={form.feeBearer} onChange={e => setForm(v => ({ ...v, feeBearer: e.target.value }))}><option value="shop">{label('shop')}</option><option value="platform">{label('platform')}</option></select></label>}</>}
        {action === 'save-beneficiary' && <>{field('payeeName', 'text', true, { maxLength: 160 })}{field('beneficiaryRef', 'text', true, { maxLength: 120 })}{field('ibanLastFour', 'text', true, { minLength: 4, maxLength: 4, pattern: '[A-Za-z0-9]{4}' })}<p>{label('beneficiaryConfirm')}</p></>}
        {action === 'record-receipt' && <><p>{label('receiptConfirm')}</p><fieldset className="settlement-booking-list"><legend>{label('bookingId')}</legend>{detailRows.map(row => <label className="settlement-checkbox" key={row.id}><input type="radio" name="booking" value={row.id} checked={form.bookingId === row.id} onChange={e => setForm(v => ({ ...v, bookingId: e.target.value }))} required /><span>{row.date} · {row.time?.slice(0, 5)} · {label(row.status)} · {money(row.priceFils)}<small>{row.id}</small></span></label>)}</fieldset>{pagination(detailPage, setDetailPage, detailMore)}{field('fee', 'text', false, { inputMode: 'decimal', placeholder: label('unknownFee') })}<label className="settlement-checkbox"><input type="checkbox" checked={form.settled} onChange={e => setForm(v => ({ ...v, settled: e.target.checked }))} />{label('settled')}</label></>}
        {['record-receipt', 'record-fee', 'record-refund', 'prepare-payout', 'confirm-payout'].includes(action) && field('amount', 'text', true, { inputMode: 'decimal' })}
        {['record-receipt', 'record-fee', 'record-refund', 'confirm-payout'].includes(action) && field('reference', 'text', true, { maxLength: 120 })}
        {['record-receipt', 'record-fee', 'record-refund', 'settle-receipt', 'confirm-payout'].includes(action) && field('date', 'datetime-local', true, { max: settlementNow(), step: 1 })}
        {action === 'prepare-statement' && field('period', 'month', true, { max: financeToday().slice(0, 7) })}
        {action === 'prepare-payout' && <p>{label('preparePayoutConfirm')}</p>}
        {action === 'confirm-payout' && <p>{label('transferConfirm', { amount: money(dialog.row.amountFils) })} {money(dialog.row.amountFils)} · {dialog.row.payeeName} · •••• {dialog.row.ibanLastFour}</p>}
        {action === 'uncertain-payout' && <p>{label('uncertainConfirm')}</p>}
        {(reasonActions.includes(action) || action === 'settings') && field('reason', 'text', true, { minLength: 3, maxLength: 240 })}
      </fieldset>
        {!readOnlyDialog && <footer><button type="button" className="btn btn-secondary" onClick={close} disabled={saving}>{label('close')}</button><button className="btn btn-primary" disabled={saving || (action === 'settings' && !details) || (action === 'record-receipt' && !form.bookingId)}>{saving ? label('saving') : label('confirm')}</button></footer>}
      </form>
      {action === 'statement' && !details && !error && <p role="status">{label('loading')}</p>}
      {action === 'statement' && details && <>
        <div className="settlement-statement-total">
          <div><span>{month(details.period)} · {label(details.state)}</span><strong>{money(details.totalFils)}</strong><span>{label('totalFils')}</span></div>
          <dl>{(statementHasAdjustments ? ['currentFils', 'paidFils', 'reservedFils'] : ['paidFils', 'reservedFils']).map(key =>
            <div key={key}><dt>{label(key)}</dt><dd>{money(details[key])}</dd></div>
          )}</dl>
        </div>
        <div className="report-table-scroll settlement-statement-items"><table><thead><tr>
          {statementColumns.map(key =>
            <th scope="col" key={key}>{label(key)}</th>
          )}
        </tr></thead><tbody>{detailRows.map(row => <tr key={row.snapshot.id}>
          {cell('bookingId', <>{row.snapshot.bookingDate}<small><bdi>{row.snapshot.bookingId}</bdi></small></>)}
          {cell('netFils', money(row.snapshot.netFils))}
          {statementHasAdjustments && cell('currentFils', money(row.current.netFils))}
          {statementHasAllocations && cell('remainingFils', <>{money(row.current.remainingFils)}{Number(row.current.paidFils) !== 0 && <small>{label('paidFils')} · {money(row.current.paidFils)}</small>}</>)}
        </tr>)}</tbody></table></div>
        {pagination(detailPage, setDetailPage, detailMore)}
        <div className="settlement-statement-actions">
          {details.state === 'final' && <button type="button" className="btn btn-secondary" disabled={exporting} onClick={() => download(details.id)}><Download size={17} />{label('excel')}</button>}
          {admin && details.state === 'draft' && <>
            <button type="button" className="btn btn-secondary" onClick={() => open('cancel-statement', details)}>{label('cancel-statement')}</button>
            <button type="button" className="btn btn-primary" onClick={() => open('finalize-statement', details)}>{label('finalize-statement')}</button>
          </>}
          {admin && details.state === 'final' && <button type="button" className="btn btn-primary" onClick={() => open('prepare-payout', details)}>{label('prepare-payout')}</button>}
        </div>
      </>}
      {action === 'journal' && <>{detailRows.map(row => <article className="settlement-journal" key={row.id}><div><strong>{label(row.kind)}</strong><span>{money(row.amountFils)}</span></div><p>{row.externalRef} · {reportDate(row.occurredAt, i18n.language, true)}</p>{row.reason && <p>{row.reason}</p>}{row.reversed ? <span>{label('reversed')}</span> : admin && ['receipt', 'fee', 'refund'].includes(row.kind) && button('reverse-event', { ...row, receiptId: dialog.row.id })}</article>)}{pagination(detailPage, setDetailPage, detailMore)}</>}
      </>}
    </dialog>
  </main>;
}
