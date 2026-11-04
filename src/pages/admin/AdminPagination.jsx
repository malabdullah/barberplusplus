import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export const ADMIN_PAGE_SIZE = 25;

export default function AdminPagination({ page, total, onPageChange, busy = false }) {
  const { t, i18n } = useTranslation();
  const pages = Math.ceil(total / ADMIN_PAGE_SIZE);
  if (pages <= 1) return null;

  const number = new Intl.NumberFormat(i18n.language).format;
  return (
    <nav className="admin-pagination" aria-label={t('admin.audit.pagination.label')}>
      <span aria-live="polite">
        {t('admin.audit.pagination.showing', {
          from: number((page - 1) * ADMIN_PAGE_SIZE + 1),
          to: number(Math.min(page * ADMIN_PAGE_SIZE, total)),
          total: number(total),
        })}
      </span>
      <div className="admin-pagination-controls">
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>
          {t('admin.audit.pagination.previous')}
        </button>
        <span>{t('admin.audit.pagination.page', { current: number(page), total: number(pages) })}</span>
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy || page >= pages} onClick={() => onPageChange(page + 1)}>
          {t('admin.audit.pagination.next')}
        </button>
      </div>
    </nav>
  );
}

export function AdminPagedList({ items, children }) {
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(items.length / ADMIN_PAGE_SIZE)));
  if (page !== currentPage) setPage(currentPage);
  const offset = (currentPage - 1) * ADMIN_PAGE_SIZE;

  return (
    <>
      {children(items.slice(offset, offset + ADMIN_PAGE_SIZE))}
      <AdminPagination page={currentPage} total={items.length} onPageChange={setPage} />
    </>
  );
}
