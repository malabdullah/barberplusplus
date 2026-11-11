import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  X,
} from 'lucide-react';
import { adminPushService } from '../../services/adminPush.service';
import './AdminPages.css';
import './Communications.css';
const blankMessage = {
  titleEn: '',
  bodyEn: '',
  titleAr: '',
  bodyAr: '',
  destination: 'none',
};
const blankFilters = {
  governorateId: '',
  city: '',
  shopIds: [],
  roles: [],
  upcoming: false,
  dateFrom: '',
  dateTo: '',
};
const errorCodes = [
  'AUTH_REQUIRED',
  'ADMIN_MFA_REQUIRED',
  'FORBIDDEN',
  'INVALID_REQUEST',
  'DELIVERY_DISABLED',
  'RATE_LIMITED',
  'AUDIENCE_TOO_LARGE',
  'NO_RECIPIENTS',
  'CONFIRMATION_REQUIRED',
  'PREVIEW_EXPIRED',
];

export default function Communications() {
  const { t, i18n } = useTranslation();
  const tr = (key, values) => t(`announcements.${key}`, values);
  const [history, setHistory] = useState({ campaigns: [], total: 0 });
  const [historyPage, setHistoryPage] = useState(1);
  const [options, setOptions] = useState({
    governorates: [],
    cities: [],
    shops: [],
    shopTotal: 0,
    delivery: {},
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState(blankMessage);
  const [language, setLanguage] = useState('en');
  const [mode, setMode] = useState('all');
  const [filters, setFilters] = useState(blankFilters);
  const [selected, setSelected] = useState({});
  const [excluded, setExcluded] = useState({});
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState({ users: [], total: 0 });
  const [userPage, setUserPage] = useState(1);
  const [shopQuery, setShopQuery] = useState('');
  const [shopPage, setShopPage] = useState(1);
  const [shopNames, setShopNames] = useState({});
  const [review, setReview] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [details, setDetails] = useState(null);
  const [recipientPage, setRecipientPage] = useState(1);
  const dialog = useRef(null);
  const detailVersion = useRef(0);
  const heading = useRef(null);
  const requestVersion = useRef(0);
  const ar = i18n.resolvedLanguage?.startsWith('ar');
  const describeError = (failure) =>
    tr(
      `errors.${
        errorCodes.includes(failure.message) ? failure.message : 'UNAVAILABLE'
      }`,
    );
  const effectiveFilters = () => ({
    ...(mode === 'filtered' ? filters : {}),
    ...(mode === 'selected' ? { userIds: Object.keys(selected) } : {}),
    excludeIds: Object.keys(excluded),
  });
  const date = (value) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      timeZone: 'Asia/Kuwait',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const refreshHistory = async () =>
    setHistory(await adminPushService.history(historyPage));
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      adminPushService.history(historyPage),
      adminPushService.options(),
    ]).then(([h, o]) => {
      if (active) {
        setHistory(h);
        setOptions(o);
      }
    })
      .catch((failure) => {
        if (active) setError(describeError(failure));
      }).finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [historyPage]);
  useEffect(() => {
    if (
      !history.campaigns.some((c) => c.results?.pending || c.results?.sending)
    ) return undefined;
    let active = true;
    const timer = setInterval(() => {
      if (!document.hidden) {
        adminPushService.history(historyPage).then((value) => {
          if (active) setHistory(value);
        }).catch(() => {});
      }
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [history.campaigns, historyPage]);
  useEffect(() => {
    const node = dialog.current;
    if (details && !node.open) node.showModal();
    if (!details && node.open) node.close();
  }, [details]);
  useEffect(() => {
    if (step) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    }
  }, [step]);
  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  };
  const start = () => {
    setMessage(blankMessage);
    setFilters(blankFilters);
    setMode('all');
    setSelected({});
    setExcluded({});
    setReview(null);
    setAcknowledged(false);
    setError('');
    setNotice('');
    setStep(1);
  };
  const searchUsers = async (page = 1) => {
    const version = ++requestVersion.current;
    setBusy(true);
    setError('');
    try {
      const result = await adminPushService.users({
        ...(mode === 'filtered' ? filters : {}),
        query,
      }, page);
      if (requestVersion.current === version) {
        setUsers(result);
        setUserPage(page);
      }
    } catch (failure) {
      if (requestVersion.current === version) setError(describeError(failure));
    } finally {
      if (requestVersion.current === version) setBusy(false);
    }
  };
  const searchShops = (page = 1) =>
    run(async () => {
      const o = await adminPushService.options(page, shopQuery);
      setOptions(o);
      setShopPage(page);
    });
  const preview = () =>
    run(async () => {
      if (mode === 'selected' && !Object.keys(selected).length) {
        setError(tr('selectRequired'));
        return;
      }
      const result = await adminPushService.preview({
        ...message,
        filters: effectiveFilters(),
      });
      setReview(result);
      setAcknowledged(false);
      setStep(3);
    });
  const send = () =>
    run(async () => {
      if (!acknowledged || !review?.campaign?.devices) return;
      await adminPushService.send(review.campaign.id);
      setStep(0);
      setNotice(
        tr(review.delivery.mode === 'capture' ? 'queuedCapture' : 'queued'),
      );
      await refreshHistory();
    });
  const closeDetails = () => {
    detailVersion.current++;
    setDetails(null);
  };
  const openDetails = (id, page = 1) =>
    run(async () => {
      const version = ++detailVersion.current;
      const result = await adminPushService.recipients(id, page);
      if (version === detailVersion.current) {
        setDetails(result);
        setRecipientPage(page);
      }
    });
  const change = (key, value) =>
    setMessage((current) => ({ ...current, [key]: value }));
  const setFilter = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const toggleUser = (user) => {
    const setter = mode === 'selected' ? setSelected : setExcluded;
    setter((current) => {
      const next = { ...current };
      if (next[user.id]) delete next[user.id];
      else next[user.id] = user;
      return next;
    });
  };
  const pager = (page, total, changePage) => (
    <div className='ann-pagination'>
      <button
        className='btn btn-secondary'
        type='button'
        disabled={busy || page === 1}
        onClick={() => changePage(page - 1)}
      >
        {tr('previous')}
      </button>
      <span>
        {tr('page', { page, total: Math.max(1, Math.ceil(total / 25)) })}
      </span>
      <button
        className='btn btn-secondary'
        type='button'
        disabled={busy || page * 25 >= total}
        onClick={() => changePage(page + 1)}
      >
        {tr('next')}
      </button>
    </div>
  );
  const counters = (campaign) => (
    <dl className='ann-counts'>
      {[['matchedUsers', 'matched'], ['eligibleUsers', 'eligible'], [
        'devices',
        'devices',
      ], ['excludedUsers', 'excluded']].map(([key, label]) => (
        <div key={key}>
          <dt>{tr(label)}</dt>
          <dd>{campaign[key] || 0}</dd>
        </div>
      ))}
    </dl>
  );
  const resultCounts = (campaign) => (
    <div className='ann-results'>
      {[
        'pending',
        'sending',
        'accepted',
        'captured',
        'skipped',
        'failed',
        'unknown',
      ].filter((key) => campaign.results?.[key]).map((key) => (
        <span className={`ann-result ann-result--${key}`} key={key}>
          {tr(`states.${key}`)} <b>{campaign.results[key]}</b>
        </span>
      ))}
    </div>
  );
  const phonePreview = (copy = message) => (
    <div
      className='ann-push-preview'
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      aria-label={tr('preview')}
    >
      <div className='ann-preview-brand'>
        <img src='/icon-192.png' alt='' />
        <span>Barber++</span>
        <Bell size={16} aria-hidden='true' />
      </div>
      <strong>
        {language === 'ar' ? copy.titleAr || copy.titleEn : copy.titleEn}
      </strong>
      <p>{language === 'ar' ? copy.bodyAr || copy.bodyEn : copy.bodyEn}</p>
    </div>
  );
  const languageButtons = (
    <div className='ann-language'>
      <button
        type='button'
        aria-pressed={language === 'en'}
        onClick={() => setLanguage('en')}
      >
        {tr('english')}
      </button>
      <button
        type='button'
        aria-pressed={language === 'ar'}
        onClick={() => setLanguage('ar')}
      >
        {tr('arabic')}
      </button>
    </div>
  );
  return (
    <div className='admin-page ann-page'>
      <header className='ann-header'>
        <div>
          <h1 ref={heading} tabIndex={-1}>{tr(step ? 'new' : 'title')}</h1>
          {!step && <p>{tr('subtitle')}</p>}
        </div>
        {step
          ? (
            <button
              className='btn btn-secondary'
              disabled={busy}
              onClick={() => {
                setStep(0);
                setError('');
              }}
            >
              {tr('close')}
            </button>
          )
          : (
            <button
              className='btn btn-primary'
              onClick={start}
              disabled={loading}
            >
              <Plus size={18} />
              {tr('new')}
            </button>
          )}
      </header>
      {error && <p className='ann-alert' role='alert'>{error}</p>}
      {notice && (
        <p className='ann-notice' role='status'>
          <Check size={18} />
          {notice}
        </p>
      )}
      {loading
        ? (
          <div className='ann-loading' role='status'>
            <Loader2 className='cb-spinner' />
            {tr('loading')}
          </div>
        )
        : !step
        ? (
          <>
            <div className='ann-history-heading'>
              <h2>{tr('history')}</h2>
              <button
                className='ann-icon'
                aria-label={tr('refresh')}
                onClick={() => run(refreshHistory)}
                disabled={busy}
              >
                <RefreshCw size={18} />
              </button>
            </div>
            {!history.campaigns.length
              ? (
                <div className='ann-empty'>
                  <Bell size={28} />
                  <h3>{tr('empty')}</h3>
                </div>
              )
              : (
                <div className='ann-table-wrap'>
                  <table className='ann-table'>
                    <thead>
                      <tr>
                        <th>{tr('message')}</th>
                        <th>{tr('audience')}</th>
                        <th>{tr('results')}</th>
                        <th>{tr('sentAt')}</th>
                        <th>
                          <span className='sr-only'>{tr('actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.campaigns.map((c) => (
                        <tr key={c.id}>
                          <td data-label={tr('message')}>
                            <strong>{ar && c.titleAr || c.titleEn}</strong>
                          </td>
                          <td data-label={tr('audience')}>
                            {tr('audienceCount', {
                              users: c.eligibleUsers,
                              devices: c.devices,
                            })}
                          </td>
                          <td data-label={tr('results')}>{resultCounts(c)}</td>
                          <td data-label={tr('sentAt')}>
                            {date(c.queuedAt || c.createdAt)}
                          </td>
                          <td>
                            <button
                              className='btn btn-secondary'
                              disabled={busy}
                              onClick={() => openDetails(c.id)}
                            >
                              {tr('details')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            {history.total > 25 &&
              pager(historyPage, history.total, setHistoryPage)}
          </>
        )
        : (
          <>
            <ol className='ann-steps' aria-label={tr('stepsLabel')}>
              {['message', 'audience', 'review'].map((label, i) => (
                <li
                  key={label}
                  aria-current={step === i + 1 ? 'step' : undefined}
                >
                  <span>{i + 1}</span>
                  {tr(label)}
                </li>
              ))}
            </ol>
            {step === 1 && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!message.titleEn.trim() || !message.bodyEn.trim()) {
                    setError(tr('errors.INVALID_REQUEST'));
                    return;
                  }
                  if (
                    Boolean(message.titleAr.trim()) !==
                      Boolean(message.bodyAr.trim())
                  ) {
                    setError(tr('arabicPair'));
                    return;
                  }
                  setError('');
                  setStep(2);
                  setUsers({ users: [], total: 0 });
                }}
              >
                <div className='ann-compose'>
                  <div className='ann-fields'>
                    <div className='ann-field'>
                      <label htmlFor='ann-title-en'>{tr('titleEn')}</label>
                      <input
                        id='ann-title-en'
                        className='form-input'
                        value={message.titleEn}
                        maxLength={80}
                        onChange={(e) => change('titleEn', e.target.value)}
                        required
                      />
                    </div>
                    <div className='ann-field'>
                      <label htmlFor='ann-body-en'>{tr('bodyEn')}</label>
                      <textarea
                        id='ann-body-en'
                        className='form-input'
                        value={message.bodyEn}
                        maxLength={500}
                        rows={5}
                        onChange={(e) => change('bodyEn', e.target.value)}
                        required
                      />
                    </div>
                    <details className='ann-arabic-fields'>
                      <summary>{tr('arabicOptional')}</summary>
                      <div className='ann-field'>
                        <label htmlFor='ann-title-ar'>{tr('titleAr')}</label>
                        <input
                          id='ann-title-ar'
                          className='form-input'
                          dir='rtl'
                          value={message.titleAr}
                          maxLength={80}
                          onChange={(e) => change('titleAr', e.target.value)}
                        />
                      </div>
                      <div className='ann-field'>
                        <label htmlFor='ann-body-ar'>{tr('bodyAr')}</label>
                        <textarea
                          id='ann-body-ar'
                          className='form-input'
                          dir='rtl'
                          value={message.bodyAr}
                          maxLength={500}
                          rows={5}
                          onChange={(e) => change('bodyAr', e.target.value)}
                        />
                      </div>
                    </details>
                    <div className='ann-field'>
                      <label htmlFor='ann-destination'>
                        {tr('destination')}
                      </label>
                      <select
                        id='ann-destination'
                        className='form-input'
                        value={message.destination}
                        onChange={(e) => change('destination', e.target.value)}
                      >
                        {['none', 'book', 'account', 'favourites'].map(
                          (value) => (
                            <option key={value} value={value}>
                              {tr(`destinations.${value}`)}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>
                  <aside>
                    <h2>{tr('preview')}</h2>
                    {languageButtons}
                    {phonePreview()}
                  </aside>
                </div>
                <footer className='ann-footer'>
                  <button className='btn btn-primary' type='submit'>
                    {tr('chooseAudience')}
                    <ArrowRight size={17} />
                  </button>
                </footer>
              </form>
            )}
            {step === 2 && (
              <>
                <fieldset className='ann-mode'>
                  <legend>{tr('recipients')}</legend>
                  {['all', 'filtered', 'selected'].map((value) => (
                    <label key={value}>
                      <input
                        type='radio'
                        name='ann-audience-mode'
                        value={value}
                        checked={mode === value}
                        disabled={busy}
                        onChange={() => {
                          setMode(value);
                          setUsers({ users: [], total: 0 });
                          setQuery('');
                        }}
                      />
                      {tr(`modes.${value}`)}
                    </label>
                  ))}
                </fieldset>
                {mode === 'filtered' && (
                  <div className='ann-filters'>
                    <div className='ann-field'>
                      <label htmlFor='ann-governorate'>
                        {tr('governorate')}
                      </label>
                      <select
                        id='ann-governorate'
                        className='form-input'
                        disabled={busy}
                        value={filters.governorateId}
                        onChange={(e) => {
                          setFilter('governorateId', e.target.value);
                          setFilter('city', '');
                        }}
                      >
                        <option value=''>{tr('allGovernorates')}</option>
                        {options.governorates.map((g) => (
                          <option key={g.id} value={g.id}>
                            {ar ? g.nameAr : g.nameEn}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className='ann-field'>
                      <label htmlFor='ann-city'>{tr('city')}</label>
                      <select
                        id='ann-city'
                        className='form-input'
                        disabled={busy}
                        value={filters.city}
                        onChange={(e) => setFilter('city', e.target.value)}
                      >
                        <option value=''>{tr('allCities')}</option>
                        {options.cities.filter((c) =>
                          !filters.governorateId ||
                          String(c.governorateId) === filters.governorateId
                        ).map((c) => (
                          <option
                            key={`${c.governorateId}:${c.city}`}
                            value={c.city}
                          >
                            {c.city}
                          </option>
                        ))}
                      </select>
                    </div>
                    <fieldset className='ann-roles'>
                      <legend>{tr('accountRoles')}</legend>
                      {['customer', 'manager', 'barber'].map((role) => (
                        <label key={role}>
                          <input
                            type='checkbox'
                            checked={filters.roles.includes(role)}
                            disabled={busy}
                            onChange={(e) =>
                              setFilter(
                                'roles',
                                e.target.checked
                                  ? [...filters.roles, role]
                                  : filters.roles.filter((r) =>
                                    r !== role
                                  ),
                              )}
                          />
                          {tr(`roles.${role}`)}
                        </label>
                      ))}
                    </fieldset>
                    <details className='ann-shop-picker'>
                      <summary>
                        {tr('shops', { count: filters.shopIds.length })}
                      </summary>
                      <form
                        className='ann-search'
                        onSubmit={(e) => {
                          e.preventDefault();
                          searchShops();
                        }}
                      >
                        <label className='sr-only' htmlFor='ann-shop-query'>
                          {tr('searchShops')}
                        </label>
                        <input
                          id='ann-shop-query'
                          className='form-input'
                          value={shopQuery}
                          maxLength={120}
                          onChange={(e) => setShopQuery(e.target.value)}
                          placeholder={tr('searchShops')}
                        />
                        <button
                          className='btn btn-secondary'
                          disabled={busy}
                          type='submit'
                        >
                          <Search size={17} />
                          {tr('search')}
                        </button>
                      </form>
                      <div className='ann-shop-list'>
                        {options.shops.map((s) => (
                          <label key={s.id}>
                            <input
                              type='checkbox'
                              disabled={busy}
                              checked={filters.shopIds.includes(s.id)}
                              onChange={(e) => {
                                setFilter(
                                  'shopIds',
                                  e.target.checked
                                    ? [...filters.shopIds, s.id]
                                    : filters.shopIds.filter((id) =>
                                      id !== s.id
                                    ),
                                );
                                setShopNames((n) => ({
                                  ...n,
                                  [s.id]: ar && s.nameAr || s.name,
                                }));
                              }}
                            />
                            <span>
                              {ar && s.nameAr || s.name}
                              <small>{s.city}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                      {pager(shopPage, options.shopTotal, searchShops)}
                    </details>
                    <div className='ann-chips'>
                      {filters.shopIds.map((id) => (
                        <button
                          type='button'
                          disabled={busy}
                          key={id}
                          onClick={() =>
                            setFilter(
                              'shopIds',
                              filters.shopIds.filter((v) => v !== id),
                            )}
                        >
                          {shopNames[id] || tr('shop')}
                          <X size={14} />
                        </button>
                      ))}
                    </div>
                    <label className='ann-checkbox'>
                      <input
                        type='checkbox'
                        disabled={busy}
                        checked={filters.upcoming}
                        onChange={(e) =>
                          setFilter('upcoming', e.target.checked)}
                      />
                      {tr('upcomingOnly')}
                    </label>
                    <div className='ann-field'>
                      <label htmlFor='ann-date-from'>{tr('dateFrom')}</label>
                      <input
                        id='ann-date-from'
                        className='form-input'
                        type='date'
                        disabled={busy}
                        value={filters.dateFrom}
                        onChange={(e) => setFilter('dateFrom', e.target.value)}
                      />
                    </div>
                    <div className='ann-field'>
                      <label htmlFor='ann-date-to'>{tr('dateTo')}</label>
                      <input
                        id='ann-date-to'
                        className='form-input'
                        type='date'
                        disabled={busy}
                        min={filters.dateFrom || undefined}
                        value={filters.dateTo}
                        onChange={(e) => setFilter('dateTo', e.target.value)}
                      />
                    </div>
                  </div>
                )}
                <div className='ann-user-picker'>
                  <h2>
                    {tr(
                      mode === 'selected'
                        ? 'selectCustomers'
                        : 'excludeCustomers',
                    )}
                  </h2>
                  <div className='ann-chips'>
                    {Object.values(mode === 'selected' ? selected : excluded)
                      .map((user) => (
                        <button
                          key={user.id}
                          type='button'
                          disabled={busy}
                          onClick={() => toggleUser(user)}
                        >
                          {user.name || user.email}
                          <X size={14} />
                        </button>
                      ))}
                  </div>
                  <form
                    className='ann-search'
                    onSubmit={(e) => {
                      e.preventDefault();
                      searchUsers();
                    }}
                  >
                    <label className='sr-only' htmlFor='ann-customer-query'>
                      {tr('searchCustomers')}
                    </label>
                    <input
                      id='ann-customer-query'
                      className='form-input'
                      value={query}
                      maxLength={120}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={tr('searchCustomers')}
                    />
                    <button
                      className='btn btn-secondary'
                      disabled={busy}
                      type='submit'
                    >
                      <Search size={17} />
                      {tr('search')}
                    </button>
                  </form>
                  <div className='ann-user-list'>
                    {users.users.map((user) => (
                      <label key={user.id}>
                        <input
                          type='checkbox'
                          disabled={busy}
                          checked={Boolean(
                            (mode === 'selected' ? selected : excluded)[
                              user.id
                            ],
                          )}
                          onChange={() => toggleUser(user)}
                        />
                        <span>
                          <strong>{user.name}</strong>
                          <small>
                            <bdi>{user.email}</bdi> · {tr(`roles.${user.role}`)}
                          </small>
                        </span>
                        <span className='ann-user-status'>
                          {user.exclusion
                            ? tr(`exclusions.${user.exclusion}`)
                            : tr('deviceCount', { count: user.devices })}
                        </span>
                      </label>
                    ))}
                  </div>
                  {users.total > 25 &&
                    pager(userPage, users.total, searchUsers)}
                </div>
                <footer className='ann-footer'>
                  <button
                    className='btn btn-secondary'
                    disabled={busy}
                    onClick={() => setStep(1)}
                  >
                    <ArrowLeft size={17} />
                    {tr('back')}
                  </button>
                  <button
                    className='btn btn-primary'
                    disabled={busy ||
                      mode === 'selected' && !Object.keys(selected).length}
                    onClick={preview}
                  >
                    {busy
                      ? <Loader2 size={17} className='cb-spinner' />
                      : <ArrowRight size={17} />}
                    {tr('review')}
                  </button>
                </footer>
              </>
            )}
            {step === 3 && review && (
              <>
                <div className='ann-review-header'>
                  <h2>{tr('review')}</h2>
                  {review.delivery.mode === 'capture' && (
                    <span className='ann-capture'>{tr('captureMode')}</span>
                  )}
                </div>
                {counters(review.campaign)}
                <div className='ann-compose'>
                  <section>
                    <h2>{tr('message')}</h2>
                    {languageButtons}
                    {phonePreview(review.campaign)}
                    <p className='ann-destination'>
                      {tr('destination')}:{' '}
                      {tr(`destinations.${review.campaign.destination}`)}
                    </p>
                    <button
                      type='button'
                      className='ann-text'
                      disabled={busy}
                      onClick={() => setStep(1)}
                    >
                      {tr('editMessage')}
                    </button>
                  </section>
                  <section>
                    <h2>{tr('audience')}</h2>
                    <p>
                      {tr('audienceCount', {
                        users: review.campaign.eligibleUsers,
                        devices: review.campaign.devices,
                      })}
                    </p>
                    <button
                      type='button'
                      className='ann-text'
                      disabled={busy}
                      onClick={() => setStep(2)}
                    >
                      {tr('editAudience')}
                    </button>
                    <button type='button' className='ann-text ann-review-recipients' disabled={busy} onClick={() => openDetails(review.campaign.id)}>{tr('recipients')}</button>
                    <p className='ann-expiry'>
                      {tr('previewUntil', {
                        date: date(review.campaign.previewExpiresAt),
                      })}
                    </p>
                    {!review.campaign.devices && (
                      <p role='status'>{tr('noRecipients')}</p>
                    )}
                  </section>
                </div>
                <label className='ann-confirm'>
                  <input
                    type='checkbox'
                    checked={acknowledged}
                    disabled={busy || !review.campaign.devices}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  {tr(
                    review.delivery.mode === 'capture'
                      ? 'confirmCapture'
                      : 'confirmSend',
                    {
                      users: review.campaign.eligibleUsers,
                      devices: review.campaign.devices,
                    },
                  )}
                </label>
                <footer className='ann-footer'>
                  <button
                    className='btn btn-secondary'
                    disabled={busy}
                    onClick={() => setStep(2)}
                  >
                    {tr('back')}
                  </button>
                  <button
                    className='btn btn-primary'
                    disabled={busy || !acknowledged || !review.campaign.devices}
                    onClick={send}
                  >
                    {busy
                      ? <Loader2 size={17} className='cb-spinner' />
                      : <Send size={17} />}
                    {tr(
                      review.delivery.mode === 'capture'
                        ? 'sendCapture'
                        : 'sendNow',
                    )}
                  </button>
                </footer>
              </>
            )}
          </>
        )}
      <dialog
        ref={dialog}
        className='ann-dialog'
        aria-labelledby='ann-details-title'
        onCancel={closeDetails}
      >
        <header>
          <h2 id='ann-details-title'>{tr('details')}</h2>
          <button
            className='ann-icon'
            aria-label={tr('close')}
            onClick={closeDetails}
          >
            <X />
          </button>
        </header>
        {details && (
          <div className='ann-dialog-body'>
            <h3>
              {ar && details.campaign.titleAr || details.campaign.titleEn}
            </h3>
            <p className='ann-sender'>
              {tr('sentBy', {
                name: details.campaign.createdByName || tr('deletedAccount'),
              })}
            </p>
            <p className='ann-message-copy'>
              {ar && details.campaign.bodyAr || details.campaign.bodyEn}
            </p>
            {counters(details.campaign)}
            {resultCounts(details.campaign)}
            <h3>{tr('recipients')}</h3>
            <div className='ann-recipient-list'>
              {details.users.map((user) => (
                <div key={user.id || user.email}>
                  <span>
                    <strong>{user.name || tr('deletedAccount')}</strong>
                    <small>
                      <bdi>{user.email}</bdi>
                    </small>
                  </span>
                  <span>
                    {user.exclusion
                      ? tr(`exclusions.${user.exclusion}`)
                      : tr('deviceCount', { count: user.devices })}
                    {user.results && resultCounts(user)}
                  </span>
                </div>
              ))}
            </div>
            {details.campaign.matchedUsers > 25 &&
              pager(
                recipientPage,
                details.campaign.matchedUsers,
                (page) => openDetails(details.campaign.id, page),
              )}
          </div>
        )}
        <footer>
          <button className='btn btn-secondary' onClick={closeDetails}>
            {tr('close')}
          </button>
        </footer>
      </dialog>
    </div>
  );
}
