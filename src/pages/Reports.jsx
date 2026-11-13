import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ArrowUpRight, ArrowDownRight, ArrowRight, RefreshCw, SlidersHorizontal, X, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { buildReportTrend } from '../utils/reportTrend';
import { useApp } from '../context/AppContext';
import { reportsService } from '../services/reports.service';
import { exportReport } from '../services/reportExport.service';
import { averageFils, reportMoney, reportChange, reportDate, localizedReportName, serviceReportNames } from '../utils/reportFormatting';
import './Reports.css';

const reportTypes = ['overview', 'shops', 'barbers', 'services', 'bookings', 'customers', 'demand', 'ratings'];

function Filters({ value, onChange, options, personalOnly, t }) {
  const id = useId();
  const update = patch => onChange({ ...value, ...patch });
  return <>
    <label>{t('reports.type')}<select className="form-select" value={value.personal && !personalOnly ? 'personal' : value.type} onChange={event => update({ type: event.target.value === 'personal' ? 'overview' : event.target.value, personal: personalOnly || event.target.value === 'personal', ...(event.target.value === 'personal' ? { shopIds: [] } : {}) })}>
      {reportTypes.filter(type => !(personalOnly && ['shops', 'barbers'].includes(type))).map(type => <option key={type} value={type}>{t(`reports.types.${type}`)}</option>)}
      {!personalOnly && options.hasChair && <option value="personal">{t('reports.personal')}</option>}
    </select></label>
    {!personalOnly && !value.personal && options.shops.length > 1 && <fieldset className="report-shop-scope"><legend>{t('reports.shops')}</legend><details><summary className="form-select">{value.shopIds.length ? t('reports.selectedShops', { count: value.shopIds.length }) : t('reports.allShops')}</summary><div className="report-shop-options">
      <label htmlFor={`${id}-all`}><input id={`${id}-all`} type="checkbox" checked={!value.shopIds.length} onChange={() => update({ shopIds: [] })} />{t('reports.allShops')}</label>
      {options.shops.map(shop => <label key={shop.id}><input type="checkbox" checked={value.shopIds.includes(shop.id)} onChange={event => update({ shopIds: event.target.checked ? [...value.shopIds, shop.id] : value.shopIds.filter(item => item !== shop.id) })} />{shop.nameAr && document.documentElement.dir === 'rtl' ? shop.nameAr : shop.name}</label>)}
    </div></details></fieldset>}
    <label>{t('reports.period')}<select className="form-select" value={value.preset} onChange={event => update({ preset: event.target.value })}>
      {['month', 'lastMonth', 'custom'].map(preset => <option key={preset} value={preset}>{t(`reports.presets.${preset}`)}</option>)}
    </select></label>
    {value.preset === 'custom' && <><label>{t('reports.from')}<input className="form-input" type="date" required value={value.from} onChange={event => update({ from: event.target.value })} /></label><label>{t('reports.to')}<input className="form-input" type="date" required min={value.from} value={value.to} onChange={event => update({ to: event.target.value })} /></label></>}
  </>;
}

export default function Reports({ personal = false }) {
  const { t, i18n } = useTranslation();
  const { user } = useApp();
  const language = i18n.language;
  const number = value => new Intl.NumberFormat(language).format(value);
  const money = value => reportMoney(value, language);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuwait' });
  const [filters, setFilters] = useState({ type: 'overview', preset: 'month', from: today.slice(0, 8) + '01', to: today, shopIds: [], personal });
  const [options, setOptions] = useState(null);
  const [report, setReport] = useState(null);
  const [applied, setApplied] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(null);
  const [notice, setNotice] = useState('');
  const [groups, setGroups] = useState([]);
  const [groupCursors, setGroupCursors] = useState([0]);
  const [groupPage, setGroupPage] = useState(0);
  const [groupNext, setGroupNext] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [cursors, setCursors] = useState([0]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [rowBusy, setRowBusy] = useState(false);
  const [rowError, setRowError] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const mounted = useRef(true);
  const exportAbort = useRef(null);
  const requestSequence = useRef(0);
  const filterDialog = useRef(null);
  const filterButton = useRef(null);
  const detailsRef = useRef(null);
  const dirty = report && applied !== JSON.stringify(filters);
  const ready = report?.state === 'ready';
  const summary = report?.result?.summary;
  const previous = report?.result?.previous;
  const name = row => row.kind === 'unallocated' ? t('reports.unallocated') : localizedReportName(row, language) || t('reports.unknown');
  const clearSensitive = failure => {
    if (/FORBIDDEN|NOT_FOUND|EXPIRED/.test(failure.message)) { setReport(null); setGroups([]); setRows([]); }
    return t(`reports.errors.${failure.message}`, { defaultValue: t('reports.errors.REPORT_FAILED') });
  };
  useEffect(() => {
    let current = true;
    mounted.current = true;
    setOptions(null); setReport(null); setRows([]); setGroups([]); setError('');
    reportsService.options().then(value => { if (current) setOptions(value); }).catch(failure => { if (current) setError(t(`reports.errors.${failure.message}`, { defaultValue: t('reports.errors.REPORT_FAILED') })); });
    return () => { current = false; mounted.current = false; requestSequence.current++; exportAbort.current?.abort(); };
  }, [user?.id, personal]);
  useEffect(() => { const previousTitle = document.title; document.title = `${t(personal ? 'reports.personal' : 'reports.title')} | Barber++`; return () => { document.title = previousTitle; }; }, [t, personal]);

  useEffect(() => {
    if (!ready || !detailsOpen) return;
    let current = true;
    setRowBusy(true); setRowError(''); setRows([]);
    reportsService.rows(report.id, { after: cursors[page] || 0, limit: 25, status, search: appliedSearch }).then(value => {
      if (!current) return;
      setRows(value.rows.slice(0, 25)); setHasNext(value.rows.length > 25);
    }).catch(failure => { if (current) setRowError(clearSensitive(failure)); }).finally(() => { if (current) setRowBusy(false); });
    return () => { current = false; };
  }, [report?.id, ready, detailsOpen, page, cursors, status, appliedSearch]);

  async function generate(event, override) {
    event?.preventDefault();
    const selected = override || filters;
    if (override) setFilters(override);
    filterDialog.current?.close();
    const sequence = ++requestSequence.current;
    exportAbort.current?.abort();
    setBusy(true); setError(''); setNotice(''); setReport(null); setGroups([]); setRows([]); setDetailsOpen(false);
    try {
      const job = await reportsService.generate(selected);
      let value;
      for (let i = 0; i < 185; i++) {
        if (!mounted.current || sequence !== requestSequence.current) return;
        value = await reportsService.get(job.id);
        if (value.state !== 'queued') break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (value.state !== 'ready') throw new Error(value.error || 'REPORT_FAILED');
      if (!mounted.current || sequence !== requestSequence.current) return;
      setReport(value); setApplied(JSON.stringify(selected)); setGroups(value.result.breakdown); setGroupPage(0); setGroupCursors([0]); setGroupNext(value.result.breakdownTotal > 20);
      setStatus(''); setSearch(''); setAppliedSearch(''); setPage(0); setCursors([0]);
      setDetailsOpen(selected.type === 'bookings' || selected.type === 'ratings' && selected.personal);
    } catch (failure) { if (mounted.current && sequence === requestSequence.current) setError(clearSensitive(failure)); }
    finally { if (mounted.current && sequence === requestSequence.current) setBusy(false); }
  }

  async function exportExcel() {
    const controller = new AbortController();
    exportAbort.current = controller;
    setExporting({ loaded: 0, total: report.total }); setError(''); setNotice('');
    try {
      const labels = t('reports.exportLabels', { returnObjects: true });
      const blob = await exportReport(report, labels, language, (loaded, total) => { if (mounted.current) setExporting({ loaded, total }); }, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `Barber++-${report.type}-${report.from}-${report.to}.xlsx`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice(t('reports.exportReady'));
    } catch (failure) { if (mounted.current && failure.name !== 'AbortError') setError(clearSensitive(failure)); }
    finally { if (mounted.current) setExporting(null); }
  }

  async function groupNavigate(next) {
    setRowError('');
    const after = next > groupPage ? groups.at(-1)?.ordinal || 20 : groupCursors[next];
    try {
      const value = await reportsService.groups(report.id, { after, limit: 20 });
      setGroups(value.rows.slice(0, 20)); setGroupNext(value.rows.length > 20); setGroupPage(next);
      setGroupCursors(old => { const copy = [...old]; copy[next] = after; return copy; });
    } catch (failure) { setError(clearSensitive(failure)); }
  }
  function appointments(selectedStatus = '') {
    setStatus(selectedStatus); setPage(0); setCursors([0]); setDetailsOpen(true);
    setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' }), 0);
  }
  const percent = (numerator, denominator) => denominator ? `${number(Math.round(numerator / denominator * 1000) / 10)}%` : '—';
  const score = (value, count) => count ? `${number(value)} (${number(count)})` : t('reports.noRatings');
  const change = summary ? reportChange(summary.salesFils, previous.salesFils) : null;
  const ChangeIcon = typeof change === 'number' && change < 0 ? ArrowDownRight : change === 0 ? ArrowRight : ArrowUpRight;
  const chart = ready ? buildReportTrend(report.result.trend, report.from, report.to, language) : [];
  const groupMetric = report?.type === 'ratings';
  const groupTitle = report?.result?.grouping;
  const allGroupsMax = Math.max(0, ...groups.map(row => Number(row.salesFils || 0)));
  const filtersProps = { value: filters, onChange: setFilters, options: options || { shops: [] }, personalOnly: personal, t };

  const statusPanel = summary ? (<section className="report-status"><h3>{t('reports.bookingStatus')}</h3>{['completed', 'cancelled', 'no_show', 'needs_status'].map(value => <button key={value} className={`report-status-row report-status-${value}`} onClick={() => appointments(value)}><span><i aria-hidden="true" />{t(`reports.statuses.${value}`)}</span><strong>{number(summary[({ no_show: 'noShow', needs_status: 'needsStatus' })[value] || value])}</strong></button>)}</section>) : null;
  return <div className="reports-page">
    <header className="reports-heading"><div><h1>{personal ? t('reports.personal') : t('reports.title')}</h1>{options?.shops?.length === 1 && <span className="reports-shop-name">{localizedReportName(options.shops[0], language)}</span>}</div>
      <button className="btn btn-secondary" onClick={exportExcel} disabled={!ready || dirty || busy || !!exporting}><Download size={18} aria-hidden="true" />{t('reports.export')}</button></header>
    <form className="report-desktop-filters" onSubmit={generate}><Filters {...filtersProps} /><button className="btn btn-primary" disabled={busy || !options || !!exporting}>{busy ? <RefreshCw size={17} className="report-spinner" aria-hidden="true" /> : null}{t(busy ? 'reports.generating' : 'reports.generate')}</button></form>
    <div className="report-mobile-filters"><button ref={filterButton} className="btn btn-secondary" onClick={() => filterDialog.current?.showModal()}><SlidersHorizontal size={18} aria-hidden="true" />{t('reports.filters')}</button><button className="btn btn-primary" disabled={busy || !options || !!exporting} onClick={generate}>{t(busy ? 'reports.generating' : 'reports.generate')}</button></div>
    <dialog className="report-filter-dialog" ref={filterDialog} onClose={() => filterButton.current?.focus()} aria-labelledby="report-filter-title"><header><h2 id="report-filter-title">{t('reports.filters')}</h2><button className="btn btn-secondary" onClick={() => filterDialog.current?.close()} aria-label={t('reports.close')}><X size={20} /></button></header><form onSubmit={generate}><Filters {...filtersProps} /><button className="btn btn-primary" disabled={busy || !options}>{t('reports.generate')}</button></form></dialog>
    {error && <p role="alert" className="report-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {exporting && <div className="report-export-progress" role="status"><span>{t('reports.exportProgress', { count: exporting.loaded, total: number(exporting.total) })}</span><progress max={Math.max(1, exporting.total)} value={exporting.loaded} /><button className="btn btn-secondary" onClick={() => exportAbort.current?.abort()}>{t('common.cancel')}</button></div>}
    {busy && <p role="status" className="report-state">{t('reports.generating')}</p>}
    {!busy && !report && !error && <p className="report-state">{t(options ? 'reports.notGenerated' : 'common.loading')}</p>}
    {ready && <>
      <div className="report-result-heading"><p>{reportDate(report.from, language)} – {reportDate(report.to, language)}<span>{t('reports.generated', { date: reportDate(report.createdAt, language, true) })}</span></p><details className="report-definitions"><summary><Info size={17} aria-hidden="true" />{t('reports.definitions')}</summary><p>{t('reports.valueDefinition')}</p><p>{t('reports.customerDefinition')}</p><p>{t('reports.historyDefinition')}</p></details></div>
      {dirty && <p role="status" className="report-outdated">{t('reports.changedFilters')}</p>}
      {!summary.total && <p className="report-state">{t('reports.empty')}</p>}
      <div className="report-main-grid">
        <section className="report-breakdown" aria-labelledby="report-breakdown-title"><h2 id="report-breakdown-title">{t(report.type === 'ratings' ? 'reports.types.ratings' : `reports.groupTitles.${groupTitle}`)}</h2>
          {report.type === 'ratings' && report.personal ? <dl><div><dt>{t('reports.shopRating')}</dt><dd>{score(summary.shopRating, summary.shopRatingCount)}</dd></div><div><dt>{t('reports.barberRating')}</dt><dd>{score(summary.barberRating, summary.barberRatingCount)}</dd></div></dl> : report.type === 'demand' ? <div className="report-demand-table"><table><caption className="sr-only">{t('reports.types.demand')}</caption><thead><tr><th>{t('reports.day')}</th><th>{t('reports.startTime')}</th><th>{t('reports.visits')}</th><th>{t('reports.bookedHours')}</th></tr></thead><tbody>{report.result.demand.filter(row => row.completed > 0).map(row => <tr key={`${row.dayOfWeek}-${row.hour}`}><td>{t(`reports.weekdays.${row.dayOfWeek}`)}</td><td><bdi>{String(row.hour).padStart(2, '0')}:00</bdi></td><td>{number(row.completed)}</td><td>{number(Math.round(row.minutes / 6) / 10)}</td></tr>)}</tbody></table></div> : groups.map(row => <article className="report-performance-row" key={row.id}>
            <div className="report-row-copy"><h3>{name(row)}</h3><p>{t('reports.visitsCount', { count: row.completed })}{row.kind && <span> · {t(`reports.kinds.${row.kind}`)}</span>}</p></div>
            <strong className="report-row-value"><bdi>{groupMetric ? score(row.barberRating, row.barberRatingCount) : money(row.salesFils)}</bdi></strong>
            {!groupMetric && row.salesFils !== null && <meter className="report-bar" min={0} max={Math.max(1, allGroupsMax)} value={Math.max(0, Number(row.salesFils || 0))} aria-label={`${name(row)} ${money(row.salesFils)}`} />}
            {groupTitle === 'shops' && <button className="report-text-action" disabled={busy || !!exporting} onClick={() => generate(null, { ...filters, shopIds: [row.id], type: 'overview', personal: false })}>{t('reports.viewShop')}<ArrowRight size={16} aria-hidden="true" /></button>}
            {groupMetric && <p className="report-row-extra">{t('reports.shopRating')}: {score(row.shopRating, row.shopRatingCount)} · {t('reports.barberRating')}: {score(row.barberRating, row.barberRatingCount)}</p>}
            {!groupMetric && (row.customers !== undefined || row.kind === 'unallocated') && <details className="report-row-extra"><summary>{t('reports.details')}</summary>{row.kind === 'unallocated' ? <p>{t('reports.unallocatedDefinition')}</p> : <dl><div><dt>{t('reports.customers')}</dt><dd>{number(row.customers)}</dd></div><div><dt>{t('reports.newCustomers')}</dt><dd>{number(row.newCustomers)}</dd></div><div><dt>{t('reports.returningCustomers')}</dt><dd>{number(row.returningCustomers)}</dd></div><div><dt>{t('reports.shopRating')}</dt><dd>{score(row.shopRating, row.shopRatingCount)}</dd></div><div><dt>{t('reports.barberRating')}</dt><dd>{score(row.barberRating, row.barberRatingCount)}</dd></div></dl>}</details>}
          </article>)}
          {(groupPage > 0 || groupNext) && <nav className="report-pagination" aria-label={t('reports.breakdownPagination')}><button className="btn btn-secondary" disabled={!groupPage} onClick={() => groupNavigate(groupPage - 1)}><ChevronLeft size={16} />{t('common.previous')}</button><span>{number(groupPage + 1)}</span><button className="btn btn-secondary" disabled={!groupNext} onClick={() => groupNavigate(groupPage + 1)}>{t('common.next')}<ChevronRight size={16} /></button></nav>}
        </section>
        <aside className="report-overview"><h2>{t('reports.atGlance')}</h2><span>{t(personal || report.personal ? 'reports.bookingValue' : 'reports.sales')}</span><strong className="report-total"><bdi>{money(summary.salesFils)}</bdi></strong>
          {change !== null && <p className="report-comparison"><ChangeIcon size={17} aria-hidden="true" />{change === 'new' ? t('reports.newActivity') : t('reports.change', { value: number(Math.round(change * 10) / 10) })}<span>{reportDate(report.previousFrom, language)} – {reportDate(new Date(new Date(report.previousUntil).getTime() - 1).toISOString(), language)}</span></p>}
          <dl className="report-key-totals"><div><dt>{t('reports.visits')}</dt><dd>{number(summary.completed)}</dd></div><div><dt>{t('reports.customers')}</dt><dd>{number(summary.customers)}</dd></div><div><dt>{t('reports.average')}</dt><dd><bdi>{money(averageFils(summary.salesFils, summary.completed))}</bdi></dd></div></dl>
          <details className="report-further-metrics"><summary>{t('reports.moreMetrics')}</summary><dl><div><dt>{t('reports.newCustomers')}</dt><dd>{number(summary.newCustomers)}</dd></div><div><dt>{t('reports.returningCustomers')}</dt><dd>{number(summary.returningCustomers)}</dd></div><div><dt>{t('reports.bookedHours')}</dt><dd>{number(Math.round(summary.completedMinutes / 6) / 10)}</dd></div><div><dt>{t('reports.upcomingHours')}</dt><dd>{number(Math.round(summary.upcomingMinutes / 6) / 10)}</dd></div><div><dt>{t('reports.completionRate')}</dt><dd>{percent(summary.pastCompleted, summary.pastEnded)}</dd></div><div><dt>{t('reports.cancellationRate')}</dt><dd>{percent(summary.pastCancelled, summary.pastEnded)}</dd></div><div><dt>{t('reports.noShowRate')}</dt><dd>{percent(summary.pastNoShow, summary.pastEnded)}</dd></div><div><dt>{t('reports.shopRating')}</dt><dd>{score(summary.shopRating, summary.shopRatingCount)}</dd></div><div><dt>{t('reports.barberRating')}</dt><dd>{score(summary.barberRating, summary.barberRatingCount)}</dd></div></dl></details>
          <div className="report-desktop-status">{statusPanel}</div>
        </aside>
      </div>
      <section className="report-trend"><header><h2>{t('reports.salesTrend')}</h2><button className="report-text-action" onClick={() => appointments()}>{t('reports.viewAppointments')}<ArrowRight size={17} aria-hidden="true" /></button></header>
        <div className="report-trend-plot" role="region" aria-label={t('reports.salesTrend')} dir="ltr"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} accessibilityLayer margin={{ top: 12, right: 12, left: 0, bottom: 12 }}>
          <CartesianGrid vertical={false} stroke="var(--surface-divider)" />
          <XAxis dataKey="axisLabel" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} minTickGap={20} axisLine={false} tickLine={false} />
          <YAxis width={55} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickFormatter={value => number(value / 1000)} axisLine={false} tickLine={false} />
          <Tooltip formatter={value => [money(String(value)), t('reports.bookingPrice')]} labelFormatter={(label, payload) => payload?.[0]?.payload?.label || label} contentStyle={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--surface-divider)', borderRadius: 8 }} itemStyle={{ color: 'var(--text-primary)' }} labelStyle={{ color: 'var(--text-primary)' }} />
          <Bar dataKey="fils" fill="var(--accent-primary)" maxBarSize={72} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div>
        <details className="report-chart-data"><summary>{t('reports.chartData')}</summary><table><thead><tr><th>{t('reports.period')}</th><th>{t('reports.sales')}</th></tr></thead><tbody>{chart.map(bin => <tr key={bin.from}><td>{bin.label}</td><td><bdi>{money(String(bin.fils))}</bdi></td></tr>)}</tbody></table></details>
      </section>
      <div className="report-mobile-status">{statusPanel}</div>
      {detailsOpen && <section className="report-appointments" ref={detailsRef} aria-labelledby="report-appointments-title"><header><h2 id="report-appointments-title">{t('reports.appointments')}</h2><button className="btn btn-secondary" onClick={() => setDetailsOpen(false)}>{t('reports.close')}</button></header><form className="report-detail-filters" onSubmit={event => { event.preventDefault(); setPage(0); setCursors([0]); setAppliedSearch(search.trim()); }}><label>{t('reports.searchCustomer')}<input className="form-input" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></label><label>{t('reports.status')}<select className="form-select" value={status} onChange={event => { setStatus(event.target.value); setPage(0); setCursors([0]); }}><option value="">{t('reports.allStatuses')}</option>{['completed', 'cancelled', 'no_show', 'confirmed', 'pending', 'needs_status'].map(value => <option key={value} value={value}>{t(`reports.statuses.${value}`)}</option>)}</select></label><button className="btn btn-secondary">{t('common.search')}</button></form>
        {rowBusy && <p role="status">{t('common.loading')}</p>}{rowError && <p role="alert">{rowError}</p>}
        <div className="report-table-scroll" tabIndex={0} role="region" aria-label={t('reports.appointments')}><table><thead><tr>{['date', 'shop', 'barber', 'customer', 'services', 'status', 'bookingPrice', ...(report.type === 'ratings' ? ['shopRating', 'barberRating'] : [])].map(key => <th key={key}>{t(`reports.${key}`)}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><bdi>{reportDate(row.date, language)}<br />{row.time.slice(0, 5)}</bdi></td><td>{language.startsWith('ar') && row.shopNameAr || row.shopName}</td><td>{language.startsWith('ar') && row.barberNameAr || row.barberName}</td><td>{language.startsWith('ar') && row.customerNameAr || row.customerName}</td><td>{serviceReportNames(row, language)}</td><td>{t(`reports.statuses.${row.status}`)}</td><td><bdi>{money(row.salesFils)}</bdi></td>{report.type === 'ratings' && <><td>{row.shopRating ?? '—'}</td><td>{row.barberRating ?? '—'}</td></>}</tr>)}</tbody></table></div>
        {!rowBusy && !rowError && !rows.length && <p>{t('reports.noMatchingBookings')}</p>}<nav className="report-pagination" aria-label={t('reports.appointmentsPagination')}><button className="btn btn-secondary" disabled={!page || rowBusy} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} />{t('common.previous')}</button><span>{t('reports.page', { count: page + 1 })}</span><button className="btn btn-secondary" disabled={!hasNext || rowBusy} onClick={() => { const next = [...cursors]; next[page + 1] = rows.at(-1).ordinal; setCursors(next); setPage(value => value + 1); }}>{t('common.next')}<ChevronRight size={16} /></button></nav>
      </section>}
    </>}
  </div>;
}
