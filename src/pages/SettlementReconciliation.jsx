import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { reconciliationRpc } from '../services/settlements.service';
import { financeToday } from '../utils/financeFormatting';
import { localizedReportName, reportDate, reportMoney } from '../utils/reportFormatting';
import { settlementAmount } from '../utils/settlementFormatting';
import './Reports.css';
import './Settlements.css';

const pageSize = 25;

function useRows(action, page, filter, refresh) {
  const key = JSON.stringify([page, filter, refresh]);
  const [data, setData] = useState(null);

  useEffect(() => {
    let current = true;
    const scope = action === 'shops' ? { query: filter } : { filter };
    reconciliationRpc(action, { ...scope, offset: page * pageSize }).then(value => {
      if (current) setData({ key, rows: value.rows.slice(0, pageSize), hasMore: value.hasMore });
    }).catch(error => {
      if (current) setData({ key, error: error.message });
    });
    return () => { current = false; };
  }, [action, page, filter, key]);

  return data?.key === key ? data : null;
}

function ResultTable({ columns, data, page, setPage, empty, label, errorText }) {
  if (!data) return <p role="status" className="report-state">{label('loading')}</p>;
  if (data.error) return <p role="alert" className="report-error">{errorText(data.error)}</p>;
  return <>
    {data.rows.length ? <div className="report-table-scroll settlement-list"><table>
      <thead><tr>{columns.map(([name]) => <th key={name} scope="col">{label(name)}</th>)}</tr></thead>
      <tbody>{data.rows.map(row => <tr key={row.id}>{columns.map(([name, value]) =>
        <td key={name} data-label={label(name)}><div className="settlement-cell-value">{value(row)}</div></td>
      )}</tr>)}</tbody>
    </table></div> : <p className="report-state">{label(empty)}</p>}
    {(page > 0 || data.hasMore) && <nav className="settlement-pagination" aria-label={label('pagination')}>
      <button type="button" className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={label('previous')}><ChevronLeft size={18} /></button>
      <span>{page + 1}</span>
      <button type="button" className="btn btn-secondary" disabled={!data.hasMore} onClick={() => setPage(page + 1)} aria-label={label('next')}><ChevronRight size={18} /></button>
    </nav>}
  </>;
}

function Reconciliation() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const label = key => t(`settlements.${key}`);
  const errorText = code => t(`settlements.errors.${code}`, { defaultValue: label('errors.SETTLEMENT_FAILED') });
  const money = fils => <bdi>{reportMoney(fils, language)}</bdi>;
  const [refresh, setRefresh] = useState(0);
  const [shopPage, setShopPage] = useState(0);
  const [bankPage, setBankPage] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('unmatched');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const opener = useRef(null);
  const pending = useRef(false);
  const shops = useRows('shops', shopPage, query, refresh);
  const bank = useRows('entries', bankPage, filter, refresh);

  function openEntry() {
    dialog.current.querySelector('form').reset();
    setFormError('');
    setNotice('');
    dialog.current.showModal();
  }

  async function record(event) {
    event.preventDefault();
    if (pending.current) return;
    const fields = new FormData(event.currentTarget);
    const amountFils = settlementAmount(fields.get('amount'));
    const reference = fields.get('reference').trim();
    if (amountFils === null || !reference) {
      setFormError('SETTLEMENT_INVALID');
      return;
    }
    pending.current = true;
    setSaving(true);
    setFormError('');
    try {
      await reconciliationRpc('record', {
        amountFils, reference, direction: fields.get('direction'), bookedOn: fields.get('bookedOn'),
      });
      dialog.current?.close();
      setNotice('bankEntrySaved');
      setBankPage(0);
      setRefresh(value => value + 1);
    } catch (error) {
      setFormError(error.message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <main className="reports-page settlement-page settlement-reconciliation-page" lang={language} dir={language.startsWith('ar') ? 'rtl' : 'ltr'}>
    <header className="reports-heading settlement-heading">
      <div>
        <Link to="/admin/settlements" className="report-text-action settlement-back"><ArrowLeft size={16} />{label('title')}</Link>
        <h1>{label('reconciliation')}</h1>
      </div>
      <div className="settlement-actions">
        <button type="button" className="btn btn-secondary settlement-refresh" aria-label={label('refresh')} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={17} /></button>
      </div>
    </header>

    <section className="settlement-reconciliation-section" aria-labelledby="settlement-shop-balances">
      <div className="settlement-toolbar">
        <h2 id="settlement-shop-balances">{label('shopBalances')}</h2>
        <form onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setShopPage(0); }}>
          <label className="settlement-sr-only" htmlFor="reconciliation-shop-search">{label('searchShops')}</label>
          <input id="reconciliation-shop-search" placeholder={label('searchShops')} value={search} maxLength={100} onChange={event => setSearch(event.target.value)} />
          <button type="submit" className="btn btn-secondary">{label('search')}</button>
        </form>
      </div>
      <p className="settlement-subtitle">{label('owedExplanation')}</p>
      <ResultTable data={shops} page={shopPage} setPage={setShopPage} label={label} errorText={errorText} empty="empty" columns={[
        ['shops', row => localizedReportName(row, language)],
        ['owedFils', row => money(row.owedFils)],
        ['transferredFils', row => money(row.transferredFils)],
      ]} />
    </section>

    <section className="settlement-reconciliation-section" aria-labelledby="settlement-bank-entries">
      <div className="settlement-toolbar">
        <h2 id="settlement-bank-entries">{label('bankEntries')}</h2>
        <button type="button" ref={opener} className="btn btn-primary" onClick={openEntry}><Plus size={17} />{label('recordBankEntry')}</button>
      </div>
      {notice && <p role="status">{label(notice)}</p>}
      <nav className="settlement-tabs" aria-label={label('bankEntries')}>
        {['unmatched', 'all'].map(value => <button key={value} type="button" className={filter === value ? 'active' : ''}
          aria-pressed={filter === value} onClick={() => { setFilter(value); setBankPage(0); }}>{label(value === 'all' ? 'allBankEntries' : 'unmatchedBankEntries')}</button>)}
      </nav>
      <ResultTable data={bank} page={bankPage} setPage={setBankPage} label={label} errorText={errorText}
        empty={filter === 'all' ? 'noBankEntries' : 'noUnmatchedEntries'} columns={[
          ['reference', row => <bdi>{row.reference}</bdi>],
          ['bankDate', row => reportDate(row.bookedOn, language)],
          ['bankDirection', row => label(row.direction === 'out' ? 'bankOut' : 'bankIn')],
          ['amountFils', row => money(row.amountFils)],
          ['state', row => label(`bankStatus_${row.status}`)],
        ]} />
    </section>
    <dialog ref={dialog} aria-labelledby="reconciliation-entry-title" className="report-filter-dialog settlement-dialog reconciliation-dialog"
      onClose={() => opener.current?.focus()} onCancel={event => { if (pending.current) event.preventDefault(); }}>
      <form onSubmit={record}>
        <h2 id="reconciliation-entry-title">{label('recordBankEntry')}</h2>
        <fieldset disabled={saving}>
          <div className="reconciliation-field">
            <label htmlFor="reconciliation-entry-direction">{label('bankDirection')}</label>
            <select id="reconciliation-entry-direction" name="direction" defaultValue="in">
              <option value="in">{label('bankIn')}</option>
              <option value="out">{label('bankOut')}</option>
            </select>
          </div>
          <label>{label('bankDate')}<input name="bookedOn" type="date" defaultValue={financeToday()} min="2000-01-01" max={financeToday()} required /></label>
          <label>{label('reference')}<input name="reference" maxLength={120} autoComplete="off" required /></label>
          <label>{label('amount')}<input name="amount" inputMode="decimal" autoComplete="off" required /></label>
        </fieldset>
        {formError && <p role="alert" className="report-error">{errorText(formError)}</p>}
        <footer>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => dialog.current.close()}>{label('close')}</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{label(saving ? 'loading' : 'confirm')}</button>
        </footer>
      </form>
    </dialog>
  </main>;
}

export default function SettlementReconciliation() {
  const { user } = useApp();
  return user?.id ? <Reconciliation key={user.id} /> : null;
}
