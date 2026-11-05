import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import AdminPagination, { ADMIN_PAGE_SIZE } from './admin/AdminPagination';
import './AccountTools.css';

const paths = { admin: '/admin', manager: '/dashboard', barber: '/barber' };

export default function ShopReviews() {
  const { t, i18n } = useTranslation();
  const { userRole } = useApp();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    supabase.rpc('shop_reviews', { p_page: page }).then(({ data, error }) => {
      if (!active) return;
      if (error) setFailed(true);
      else {
        const last = Math.max(1, Math.ceil(data.total / ADMIN_PAGE_SIZE));
        if (page > last) {
          setPage(last);
          return;
        }
        setRows(data.rows);
        setTotal(data.total);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [page, attempt]);

  return (
    <section className="account-tools">
      <Link to={(paths[userRole] || '/dashboard') + '/settings'}>{t('common.back')}</Link>
      <h1>{t('privateReviews.title')}</h1>
      <p>{t('privateReviews.description')}</p>
      {loading ? <p role="status">{t('common.loading')}</p> : failed ? (
        <p role="alert">{t('accountTools.loadFailed')} <button className="btn btn-secondary" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</button></p>
      ) : rows.length ? (
        <ul className="account-tools-list">
          {rows.map(item => (
            <li key={item.id}>
              <div>
                <strong>{(i18n.language.startsWith('ar') && item.shop_ar) || item.shop}</strong>
                <p>{(i18n.language.startsWith('ar') && item.barber_ar) || item.barber} · #{item.reference}</p>
                <p>{t('privateReviews.scores', { shop: item.shop_rating, barber: item.barber_rating })}</p>
                <p className="private-review-body">{item.review}</p>
                <time dateTime={item.updated_at}>{date.format(new Date(item.updated_at))}</time>
              </div>
            </li>
          ))}
        </ul>
      ) : <p>{t('privateReviews.empty')}</p>}
      {!failed && <AdminPagination page={page} total={total} onPageChange={setPage} busy={loading} />}
    </section>
  );
}
