import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, BarChart3, Coffee, Layers, Scissors, Store, UserPlus, UserRound } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import BrandLogo from '../components/UI/BrandLogo';
import { getKuwaitDate } from '../utils/customerBooking';
import './ForShops.css';

const chairs = [
  { name: 'omar', events: [['haircut', 1, 2], ['beard', 3, 1], ['break', 7, 2], ['haircutBeard', 9, 1], ['haircut', 13, 2]] },
  { name: 'ali', events: [['haircut', 2, 2], ['haircutBeard', 5, 2], ['break', 9, 2], ['beard', 12, 1], ['haircut', 13, 2]] },
  { name: 'you', events: [['haircut', 1, 2], ['haircutBeard', 4, 2], ['beard', 7, 2], ['break', 11, 2], ['haircut', 13, 2]] },
];

function CalendarPreview({ tr, locale }) {
  const date = getKuwaitDate();
  const clock = row => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuwait' }).format(new Date(`${date}T10:00:00+03:00`).getTime() + (row - 1) * 30 * 60000);
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuwait' }).format(new Date(`${date}T12:00:00+03:00`));
  return <figure className="shops-calendar">
    <figcaption>{tr('preview')}</figcaption>
    <div className="shops-calendar-scroll" tabIndex={0} role="region" aria-label={tr('calendarLabel')}>
      <div className="shops-calendar-canvas">
        <div className="shops-calendar-bar"><BrandLogo decorative symbolOnly /><time dateTime={date}>{dateLabel}</time><CalendarDays size={19} aria-hidden="true" /></div>
        <div className="shops-calendar-head"><span /><div>{tr('omar')}</div><div>{tr('ali')}</div><div>{tr('you')}</div></div>
        <div className="shops-calendar-body">
          <div className="shops-calendar-times" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} style={{ gridRow: index * 2 + 1 }}>{clock(index * 2 + 1)}</span>)}</div>
          {chairs.map(chair => <ol className="shops-calendar-chair" key={chair.name} aria-label={tr(chair.name)}>{chair.events.map(([service, start, length], index) => <li key={index} className={`${service === 'break' ? 'shops-calendar-break' : ''} ${length === 1 ? 'shops-calendar-short' : ''}`} style={{ gridRow: `${start} / span ${length}` }}>
            <strong>{service === 'break' && <Coffee size={12} aria-hidden="true" />}{tr(service)}</strong><span><bdi>{clock(start)} – {clock(start + length)}</bdi></span>
          </li>)}</ol>)}
        </div>
      </div>
    </div>
  </figure>;
}

function FinancePreview({ tr, locale }) {
  const now = new Date(`${getKuwaitDate()}T12:00:00+03:00`);
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(lastMonth);
  const money = value => new Intl.NumberFormat(locale, { style: 'currency', currency: 'KWD', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(value);
  const data = [850, 970, 1080, 1170, 1260, 1420].map((value, index) => ({ value, month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() - 5 + index, 15))) }));
  return <figure className="shops-finance-preview">
    <figcaption><BarChart3 size={18} aria-hidden="true" /><span>{tr('preview')} · {month}</span></figcaption>
    <dl className="shops-finance-metrics">{[['bookingValue', 1420], ['received', 1280], ['expenses', 460], ['outstanding', 140]].map(([key, value]) => <div key={key}><dt>{tr(key)}</dt><dd><bdi>{money(value)}</bdi></dd></div>)}</dl>
    <div className="shops-finance-chart" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 14, right: 2, bottom: 0, left: -12 }} accessibilityLayer={false}>
      <CartesianGrid vertical={false} stroke="#484848" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#f6f6f6', fontSize: 12 }} /><YAxis width={48} axisLine={false} tickLine={false} tick={{ fill: '#b9b9b9', fontSize: 12 }} /><Bar dataKey="value" fill="#d4a853" radius={[3, 3, 0, 0]} isAnimationActive={false} />
    </BarChart></ResponsiveContainer></div>
  </figure>;
}

export default function ForShops() {
  const { t, i18n } = useTranslation();
  const tr = key => t(`shopsIntro.${key}`);
  const arabic = i18n.language.startsWith('ar');
  const locale = arabic ? 'ar-KW' : 'en-KW';
  const signup = <Link to="/signup" className="lp-button lp-button-primary">{t('auth.createManagerAccount')}<ArrowRight size={20} aria-hidden="true" /></Link>;
  return <main className="shops-intro" dir={arabic ? 'rtl' : 'ltr'}>
    <section className="shops-hero shops-width" aria-labelledby="shops-title">
      <div className="shops-hero-copy"><h1 id="shops-title">{tr('titleShop')}<br />{tr('titleTeam')}<br />{tr('titleWorkspace')}</h1><p>{tr('intro')}</p>{signup}</div>
      <CalendarPreview tr={tr} locale={locale} />
    </section>
    <section className="shops-team shops-width" aria-labelledby="shops-team-title">
      <h2 id="shops-team-title">{tr('teamTitle')}</h2>
      <div className="shops-team-options">{[[UserPlus, 'invite'], [UserRound, 'managed']].map(([Icon, key]) => <div className="shops-team-option" key={key}><Icon size={32} strokeWidth={1.6} aria-hidden="true" /><div><h3>{tr(`${key}Title`)}</h3><p>{tr(`${key}Description`)}</p></div></div>)}</div>
      <p className="shops-chair"><Scissors size={25} strokeWidth={1.6} aria-hidden="true" /><span>{tr('chairStart')} <strong>{tr('chairName')}</strong>.</span></p>
    </section>
    <section className="shops-features shops-width" aria-label={tr('features')}>
      {[[Layers, 'services', '/shops/services-tools.webp'], [CalendarDays, 'availability', '/shops/availability-calendar.webp'], [Store, 'multiple', '/landing/shop-interior.webp']].map(([Icon, key, image]) => <article className="shops-feature" key={key}>
        <img src={image} alt="" width="1200" height="400" loading="lazy" decoding="async" />
        <Icon size={30} strokeWidth={1.6} aria-hidden="true" /><div><h3>{tr(`${key}Title`)}</h3><p>{tr(`${key}Description`)}</p></div>
      </article>)}
    </section>
    <section className="shops-finances" aria-labelledby="shops-finance-title"><div className="shops-width shops-finance-inner">
      <div><h2 id="shops-finance-title">{tr('financeTitle')}</h2><p>{tr('financeDescription')}</p></div><FinancePreview tr={tr} locale={locale} />
    </div></section>
    <section className="shops-setup shops-width" aria-labelledby="shops-setup-title"><h2 id="shops-setup-title">{tr('setupTitle')}</h2>
      <ol>{['account', 'shop', 'publish'].map((key, index) => <li key={key}><span aria-hidden="true">{new Intl.NumberFormat(locale).format(index + 1)}</span><h3>{tr(`${key}Title`)}</h3><p>{tr(`${key}Description`)}</p></li>)}</ol>
      <div className="shops-final-actions">{signup}<Link to="/login" className="lp-button lp-button-outline">{t('publicNav.teamSignIn')}</Link></div>
    </section>
  </main>;
}
