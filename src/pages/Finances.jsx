import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { financeRpc, financesService } from '../services/finances.service';
import { exportFinance } from '../services/financeExport.service';
import { financeMetrics, financeToday, parseFinanceAmount } from '../utils/financeFormatting';
import { reportMoney, reportDate, localizedReportName } from '../utils/reportFormatting';
import './Reports.css';
import './Finances.css';

const categories = ['rent', 'supplies', 'utilities', 'wages', 'maintenance', 'other'];
const methods = ['cash', 'card', 'transfer', 'other'];
export default function Finances() {
  const { t, i18n } = useTranslation();
  const { user } = useApp();
  const language = i18n.language;
  const money = value => reportMoney(value || '0', language);
  const today = financeToday();
  const [options, setOptions] = useState(null);
  const [filters, setFilters] = useState({ shopIds: [], from: today.slice(0, 8) + '01', to: today });
  const [applied, setApplied] = useState('');
  const [tab, setTab] = useState('overview');
  const [report, setReport] = useState(null);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef(null);
  const formRef = useRef(null);
  const sequence = useRef(0);
  const active = useRef(true);
  const retry = useRef(null);
  const exportAbort = useRef(null);
  const errorText = failure => t(`finance.errors.${failure.message}`, { defaultValue: t('finance.errors.FINANCE_FAILED') });
  function fail(failure) {
    if (/FORBIDDEN|NOT_FOUND|EXPIRED/.test(failure.message)) { setReport(null); setRows([]); setHistory([]); setDialog(null); exportAbort.current?.abort(); }
    setError(errorText(failure));
  }
  useEffect(() => {
    active.current = true;
    setReport(null); setRows([]); setOptions(null); setError('');
    financesService.options().then(value => { if (active.current) setOptions(value); }).catch(failure => { if (active.current) fail(failure); });
    return () => { active.current = false; sequence.current++; exportAbort.current?.abort(); };
  }, [user?.id]);
  useEffect(() => {
    const previous = document.title; document.title = `${t('finance.title')} | Barber++`;
    return () => { document.title = previous; };
  }, [t]);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal(); else dialogRef.current?.close();
  }, [dialog]);
  useEffect(() => {
    if (!options || tab === 'overview') return undefined;
    let current = true;
    setBusy(true); setRows([]); setError('');
    financeRpc(tab, { shopIds: filters.shopIds, offset: page * 25, search: query, status }).then(value => { if (current) setRows(value.rows); }).catch(failure => { if (current) fail(failure); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [options, tab, filters.shopIds, page, query, status]);
  useEffect(() => {
    if (!options) return undefined;
    let current = true; let checking = false;
    const check = async () => {
      if (document.hidden || checking) return;
      checking = true;
      try { await financesService.options(); if (report) await financesService.get(report.id); }
      catch (failure) { if (current) fail(failure); }
      finally { checking = false; }
    };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 60000);
    return () => { current = false; clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [report?.id, options]);
  async function generate(event) {
    event?.preventDefault();
    const current = ++sequence.current;
    setBusy(true); setError(''); setReport(null); setNotice('');
    try { const value = await financesService.generate(filters); if (active.current && current === sequence.current) { setReport(value); setApplied(JSON.stringify(filters)); } }
    catch (failure) { if (active.current && current === sequence.current) fail(failure); }
    finally { if (active.current && current === sequence.current) setBusy(false); }
  }
  function open(kind, row) {
    setError(''); setNotice(''); retry.current = null;
    setForm({ shopId: row?.shopId || filters.shopIds[0] || options?.shops[0]?.id || '', amount: '', date: today, method: 'cash', category: 'supplies', description: '', reference: '', reason: '' });
    setHistory([]); setDialog({ kind, row });
  }
  async function showHistory(row) {
    open('history', row); setSaving(true);
    try { const result = await financeRpc('history', { shopIds: [row.shopId], ...(tab === 'bookings' ? { bookingId: row.id } : { expenseId: row.id }) }); if (active.current) setHistory(result.rows); }
    catch (failure) { if (active.current) fail(failure); }
    finally { if (active.current) setSaving(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const { kind, row } = dialog;
    const amountFils = ['expense', 'receipt', 'refund', 'expense_payment'].includes(kind) ? parseFinanceAmount(form.amount) : null;
    if (['expense', 'receipt', 'refund', 'expense_payment'].includes(kind) && !amountFils) { setError(t('finance.errors.FINANCE_INVALID_AMOUNT')); return; }
    const action = ['expense', 'void', 'reverse'].includes(kind) ? kind : 'record';
    const payload = { shopId: form.shopId, shopIds: [form.shopId], date: form.date, ...(amountFils ? { amountFils } : {}), method: form.method, reference: form.reference, reason: form.reason };
    if (kind === 'expense') Object.assign(payload, { category: form.category, description: form.description });
    else if (kind === 'void') payload.expenseId = row.id;
    else if (kind === 'reverse') payload.entryId = row.id;
    else Object.assign(payload, { kind, ...(kind === 'expense_payment' ? { expenseId: row.id } : { bookingId: row.id }) });
    const signature = JSON.stringify({ action, payload });
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() };
    payload.requestId = retry.current.id;
    setSaving(true); setError('');
    try {
      await financeRpc(action, payload);
      if (!active.current) return;
      setDialog(null); setReport(null); setNotice(t('finance.saved'));
      if (tab !== 'overview') setOptions(value => ({ ...value }));
    } catch (failure) { if (active.current) fail(failure); }
    finally { if (active.current) setSaving(false); }
  }
  async function download() {
    const abort = new AbortController(); exportAbort.current = abort;
    setExporting(true); setError('');
    try {
      const labels = t('finance', { returnObjects: true });
      const blob = await exportFinance(report, labels, language, abort.signal);
      if (!active.current || abort.signal.aborted) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `Barber++-finances-${report.from}-${report.to}.xlsx`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (failure) { if (active.current && failure.name !== 'AbortError') fail(failure); }
    finally { if (active.current) setExporting(false); }
  }
  const update = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const invalidReport = applied !== JSON.stringify(filters);
  const selected = dialog?.row;
  return <div className="reports-page finances-page">
    <header className="reports-heading"><h1>{t('finance.title')}</h1><div className="finance-actions">{tab === 'overview' ? <button className="btn btn-secondary" disabled={!report || invalidReport || busy || exporting} onClick={download}><Download size={18} />{t(exporting ? 'finance.exporting' : 'reports.export')}</button> : tab === 'expenses' ? <button className="btn btn-primary" disabled={!options?.shops.length} onClick={() => open('expense')}><Plus size={18} />{t('finance.addExpense')}</button> : null}</div></header>
    <nav className="finance-tabs" aria-label={t('finance.title')}>{['overview', 'bookings', 'expenses'].map(value => <button className={tab === value ? 'active' : ''} key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => { setTab(value); setPage(0); setError(''); }}>{t(`finance.tabs.${value}`)}</button>)}</nav>
    <form className="finance-filters" onSubmit={tab === 'overview' ? generate : event => { event.preventDefault(); setQuery(search); setPage(0); }}>
      <label>{t('reports.shops')}<select className="form-select" disabled={busy || exporting} value={filters.shopIds[0] || ''} onChange={event => { setFilters(old => ({ ...old, shopIds: event.target.value ? [event.target.value] : [] })); setPage(0); }}><option value="">{t('reports.allShops')}</option>{options?.shops.map(shop => <option key={shop.id} value={shop.id}>{localizedReportName(shop, language)}</option>)}</select></label>
      {tab === 'overview' ? <><label>{t('reports.from')}<input className="form-input" type="date" required max={filters.to} value={filters.from} onChange={event => setFilters(old => ({ ...old, from: event.target.value }))} /></label><label>{t('reports.to')}<input className="form-input" type="date" required min={filters.from} max={today} value={filters.to} onChange={event => setFilters(old => ({ ...old, to: event.target.value }))} /></label><button className="btn btn-primary" disabled={busy || exporting || !options?.shops.length}>{t(busy ? 'reports.generating' : 'reports.generate')}</button></> : tab === 'bookings' ? <><label>{t('common.search')}<input className="form-input" value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder={t('finance.searchPlaceholder')} /></label><label>{t('reports.status')}<select className="form-select" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">{t('common.all')}</option>{['pending', 'confirmed', 'completed', 'cancelled', 'no_show'].map(value => <option key={value} value={value}>{t(`reports.statuses.${value}`)}</option>)}</select></label><button className="btn btn-secondary" disabled={busy}>{t('common.search')}</button></> : null}
    </form>
    {error && !dialog && <p role="alert" className="report-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {busy && <p role="status">{t('common.loading')}</p>}
    {tab === 'overview' && !report && !busy && <p className="report-state">{t('reports.notGenerated')}</p>}
    {tab === 'overview' && report && <>
      <div className="report-result-heading"><p>{reportDate(report.from, language)} – {reportDate(report.to, language)}<span>{t('reports.generated', { date: reportDate(report.createdAt, language, true) })}</span></p><details className="report-definitions"><summary>{t('reports.definitions')}</summary><p>{t('finance.definition')}</p><p>{t('finance.balanceDefinition')}</p></details></div>
      {invalidReport && <p role="status">{t('reports.changedFilters')}</p>}
      <section className="finance-metrics">{financeMetrics.map(key => <article key={key}><h2>{t(`finance.metrics.${key}`)}</h2><strong><bdi>{money(report.summary[key])}</bdi></strong></article>)}</section>
      <section className="report-breakdown"><h2>{t('finance.shopBreakdown')}</h2><div className="finance-table-wrap"><table><thead><tr><th>{t('reports.shops')}</th>{['salesFils', 'expenseFils', 'operatingFils', 'cashFlowFils'].map(key => <th key={key}>{t(`finance.metrics.${key}`)}</th>)}</tr></thead><tbody>{report.shops.map(shop => <tr key={shop.id}><th>{localizedReportName(shop, language)}</th>{['salesFils', 'expenseFils', 'operatingFils', 'cashFlowFils'].map(key => <td key={key}><bdi>{money(shop[key])}</bdi></td>)}</tr>)}</tbody></table></div></section>
      <section className="report-breakdown"><h2>{t('finance.currentBalances')}</h2><p className="finance-caption">{t('finance.asOf', { date: reportDate(report.createdAt, language, true) })}</p><div className="finance-metrics">{['dueFils', 'creditFils', 'payableFils'].map(key => <article key={key}><h3>{t(`finance.metrics.${key}`)}</h3><strong><bdi>{money(report.summary[key])}</bdi></strong></article>)}</div></section>
    </>}
    {tab !== 'overview' && !busy && <section className="report-breakdown finance-records">
      {!rows.length && <p className="report-state">{t('finance.empty')}</p>}
      {rows.slice(0, 25).map(row => <article className="finance-record" key={row.id}><div className="finance-record-copy"><h2>{tab === 'bookings' ? row.customer || t('reports.unknown') : row.description}</h2><p>{row.shopName}{row.barber ? ` · ${row.barber}` : ''}</p><p>{reportDate(row.date, language)}{row.time ? ` · ${row.time.slice(0, 5)}` : ''} · {tab === 'bookings' ? t(`reports.statuses.${row.status}`) : t(`finance.categories.${row.category}`)}{row.voided ? ` · ${t('finance.voided')}` : ''}</p><code>{row.id.slice(0, 8)}</code></div><dl><div><dt>{t('finance.amount')}</dt><dd>{money(row.priceFils ?? row.amountFils)}</dd></div><div><dt>{t('finance.paid')}</dt><dd>{money(row.paidFils)}</dd></div>{tab === 'bookings' ? <><div><dt>{t('finance.metrics.dueFils')}</dt><dd>{money(row.dueFils)}</dd></div>{Number(row.creditFils) > 0 && <div><dt>{t('finance.metrics.creditFils')}</dt><dd>{money(row.creditFils)}</dd></div>}</> : <div><dt>{t('finance.metrics.payableFils')}</dt><dd>{money(row.voided ? 0 : Number(row.amountFils) - Number(row.paidFils))}</dd></div>}</dl><div className="finance-actions">
        {tab === 'bookings' ? <>{Number(row.dueFils) > 0 && <button className="btn btn-primary" onClick={() => open('receipt', row)}>{t('finance.receipt')}</button>}{Number(row.paidFils) > 0 && <button className="btn btn-secondary" onClick={() => open('refund', row)}>{t('finance.refund')}</button>}</> : !row.voided && <>{Number(row.amountFils) > Number(row.paidFils) && <button className="btn btn-primary" onClick={() => open('expense_payment', row)}>{t('finance.expense_payment')}</button>}{Number(row.paidFils) === 0 && <button className="btn btn-secondary" onClick={() => open('void', row)}>{t('finance.void')}</button>}</>}
        <button className="btn btn-secondary" onClick={() => showHistory(row)}>{t('finance.history')}</button>
      </div></article>)}
      <nav className="finance-pagination" aria-label={t('finance.title')}><button className="btn btn-secondary" disabled={!page} onClick={() => setPage(old => old - 1)} aria-label={t('common.previous')}><ChevronLeft size={18} /></button><span>{new Intl.NumberFormat(language).format(page + 1)}</span><button className="btn btn-secondary" disabled={rows.length <= 25} onClick={() => setPage(old => old + 1)} aria-label={t('common.next')}><ChevronRight size={18} /></button></nav>
    </section>}
    <dialog ref={dialogRef} className="finance-dialog" onCancel={event => { if (saving) event.preventDefault(); }} onClose={() => { if (!saving) setDialog(null); }} aria-labelledby="finance-dialog-title"><header><h2 id="finance-dialog-title">{dialog ? t(`finance.${dialog.kind}`) : ''}</h2><button className="btn btn-secondary" disabled={saving} onClick={() => setDialog(null)} aria-label={t('common.close')}><X size={20} /></button></header>
      {dialog && <>{error && <p role="alert" className="report-error">{error}</p>}{selected && <p>{selected.description || selected.customer || selected.id.slice(0, 8)}</p>}
      {dialog.kind === 'history' ? <div className="finance-dialog-body">{saving ? <p>{t('common.loading')}</p> : !history.length ? <p>{t('finance.noHistory')}</p> : history.map(entry => <article className="finance-history" key={entry.id}><strong>{t(`finance.kinds.${entry.kind}`)} · {money(entry.amountFils)}</strong><p>{reportDate(entry.date, language)} · {t(`finance.methods.${entry.method}`)}{entry.reversed ? ` · ${t('finance.reversed')}` : ''}</p>{entry.reference && <p>{entry.reference}</p>}{entry.reason && <p>{entry.reason}</p>}{entry.kind !== 'reversal' && !entry.reversed && <button className="btn btn-secondary" onClick={() => open('reverse', { ...entry, shopId: selected.shopId })}>{t('finance.reverse')}</button>}</article>)}</div> : <form ref={formRef} onSubmit={save}>
        <div className="finance-dialog-body">
          {dialog.kind === 'expense' && <><label>{t('reports.shops')}<select className="form-select" value={form.shopId} onChange={event => update('shopId', event.target.value)} required>{options?.shops.map(shop => <option key={shop.id} value={shop.id}>{localizedReportName(shop, language)}</option>)}</select></label><label>{t('finance.category')}<select className="form-select" value={form.category} onChange={event => update('category', event.target.value)}>{categories.map(value => <option key={value} value={value}>{t(`finance.categories.${value}`)}</option>)}</select></label><label>{t('finance.description')}<input className="form-input" maxLength={160} required value={form.description} onChange={event => update('description', event.target.value)} /></label></>}
          {['expense', 'receipt', 'refund', 'expense_payment'].includes(dialog.kind) && <label>{t('finance.amountKwd')}<input className="form-input" type="text" inputMode="decimal" required maxLength={12} value={form.amount} onChange={event => update('amount', event.target.value)} autoComplete="off" /></label>}
          {dialog.kind !== 'void' && <label>{t('finance.date')}<input className="form-input" type="date" required max={today} min="2000-01-01" value={form.date} onChange={event => update('date', event.target.value)} /></label>}
          {['receipt', 'refund', 'expense_payment'].includes(dialog.kind) && <><label>{t('finance.method')}<select className="form-select" value={form.method} onChange={event => update('method', event.target.value)}>{methods.map(value => <option key={value} value={value}>{t(`finance.methods.${value}`)}</option>)}</select></label><label>{t('finance.reference')}<input className="form-input" maxLength={100} value={form.reference} onChange={event => update('reference', event.target.value)} /></label></>}
          {['refund', 'void', 'reverse'].includes(dialog.kind) && <label>{t('finance.reason')}<textarea className="form-input" required minLength={3} maxLength={240} value={form.reason} onChange={event => update('reason', event.target.value)} /></label>}
          {dialog.kind === 'reverse' && <p>{t('finance.reversalExplanation')}</p>}
        </div><footer><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setDialog(null)}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={saving}>{t(saving ? 'common.saving' : 'common.save')}</button></footer>
      </form>}</>}
    </dialog>
  </div>;
}
