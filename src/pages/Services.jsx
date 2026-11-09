import React, { useState, useMemo, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Scissors,
  Plus,
  Clock,
  Pencil,
  Trash2,
  Search,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import Modal from '../components/UI/Modal';
import ConfirmDialog from '../components/UI/ConfirmDialog';
import { getErrorMessage, logErrorSafely } from '../utils/errorMessages';
import './Services.css';
import ServiceForm from '../components/Forms/ServiceForm';
import PackagesPanel from '../components/Packages/PackagesPanel';
import { useSearchParams } from 'react-router-dom';

const ServiceCard = memo(function ServiceCard({ service, onEdit, onDelete, t, arabic }) {
  const handleCardClick = () => {
    onEdit(service);
  };

  const handleEditClick = (e) => {
    e.stopPropagation();
    onEdit(service);
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    onDelete(service);
  };

  return (
    <div className="service-card animate-fade-in-up" onClick={handleCardClick}>
      <div className="service-card-header">
        <div className="service-icon">
          <Scissors size={24} strokeWidth={1.5} />
        </div>
      </div>

      <div className="service-card-content">
        <h3 className="service-name" dir="auto">{(arabic && service.nameAr) || service.name}</h3>
        {service.description && (
          <p className="service-description">{service.description}</p>
        )}

        <div className="service-details">
          <div className="detail-item">
            <Clock size={16} strokeWidth={1.5} />
            <span>{service.duration} {t('common.min')}</span>
          </div>
          <div className="detail-item price">
            <span>{Number(service.price).toFixed(3)} {t('common.currency')}</span>
          </div>
        </div>

        <div className="service-card-footer">
          <div className="service-actions">
            <button
              className="action-btn"
              onClick={handleEditClick}
              title={t('services.editService')}
            >
              <Pencil size={16} strokeWidth={1.5} />
            </button>
            <button
              className="action-btn danger"
              onClick={handleDeleteClick}
              title={t('managerAudit.archiveService')}
            >
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default function Services() {
  const { t, i18n } = useTranslation();
  const arabic = i18n.resolvedLanguage?.startsWith('ar') || i18n.language?.startsWith('ar');
  const [params, setParams] = useSearchParams();
  const packages = params.get('view') === 'packages';
  const { branchServices, selectedBranch, selectedBranchId, addService, updateService, deleteService } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [deletingService, setDeletingService] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const hasSelectedShop = Boolean(selectedBranchId && selectedBranch?.id === selectedBranchId);

  const filteredServices = useMemo(() =>
    branchServices.filter((service) => service.status !== 'inactive').filter((service) =>
      [service.name, service.nameAr].some((name) => name?.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    ),
    [branchServices, searchQuery]
  );

  const handleAdd = useCallback(() => {
    setError(null);
    setEditingService(null);
    setIsFormOpen(true);
  }, []);

  const handleEdit = useCallback((service) => {
    setEditingService(service);
    setIsFormOpen(true);
  }, []);

  const handleDelete = useCallback((service) => {
    setDeletingService(service);
  }, []);

  const handleFormSubmit = async (data) => {
    setError(null);
    setIsSubmitting(true);
    try {
      if (editingService) {
        await updateService(editingService.id, data);
      } else {
        await addService(data);
      }
      setIsFormOpen(false);
      setEditingService(null);
    } catch (err) {
      logErrorSafely(err, 'Services.save');
      setError(err?.message === 'SHOP_REQUIRED'
        ? t('services.selectShopFirst')
        : getErrorMessage(err, t('services.saveFailed'), t));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (deletingService) {
      try {
        await deleteService(deletingService.id);
        setDeletingService(null);
      } catch (err) {
        logErrorSafely(err, 'Services.delete');
        setError(getErrorMessage(err, 'Failed to delete service. Please try again.'));
        setDeletingService(null);
      }
    }
  };

  return (
    <div className="services-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">{t('services.title')}</h2>
          <p className="page-description">
            {t('services.subtitle')} {selectedBranch?.name}
          </p>
        </div>
        {!packages && <button className="btn btn-primary" onClick={handleAdd} disabled={!hasSelectedShop}>
          <Plus size={18} strokeWidth={2} />
          {t('services.addService')}
        </button>}
      </div>

      <div className="package-tabs" role="tablist" aria-label={t('packages.catalogue')}><button role="tab" aria-selected={!packages} onClick={() => setParams({})}>{t('services.title')}</button><button role="tab" aria-selected={packages} onClick={() => setParams({ view: 'packages' })}>{t('packages.title')}</button></div>
      {packages ? <PackagesPanel key={selectedBranchId} shop={selectedBranchId} services={branchServices} /> : <>
      {!hasSelectedShop && <div className="form-error-banner" role="alert">{t('services.selectShopFirst')}</div>}

      {/* Search Bar */}
      <div className="services-toolbar animate-fade-in-up stagger-1">
        <div className="search-input-wrapper">
          <Search size={18} strokeWidth={1.5} />
          <input
            type="text"
            placeholder={t('services.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="services-count">
          {filteredServices.length} {filteredServices.length === 1 ? t('services.service') : t('services.servicesPlural')}
        </div>
      </div>

      {/* Services Grid */}
      {filteredServices.length > 0 ? (
        <div className="services-grid">
          {filteredServices.map((service, index) => (
            <ServiceCard
              key={service.id}
              service={service}
              onEdit={handleEdit}
              onDelete={handleDelete}
              t={t}
              arabic={arabic}
            />
          ))}
        </div>
      ) : searchQuery ? (
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">
            <Search size={48} strokeWidth={1} />
          </div>
          <h3>{t('services.noServicesFound')}</h3>
          <p>{t('services.adjustSearch')}</p>
        </div>
      ) : (
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">
            <Scissors size={48} strokeWidth={1} />
          </div>
          <h3>{t('services.noServices')}</h3>
          <p>{t('services.addFirst')}</p>
          <button className="btn btn-primary" onClick={handleAdd} disabled={!hasSelectedShop}>
            <Plus size={18} strokeWidth={2} />
            {t('services.addFirstService')}
          </button>
        </div>
      )}

      </>}
      {/* Service Form Modal */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingService(null); }}
        title={editingService ? t('services.editService') : t('services.addNewService')}
      >
        {error && (
          <div className="form-error-banner" role="alert" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--status-error-bg)', color: 'var(--status-error)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}
        <ServiceForm
          service={editingService}
          onSubmit={handleFormSubmit}
          onCancel={() => { setIsFormOpen(false); setEditingService(null); setError(null); }}
          isSubmitting={isSubmitting}
        />
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingService}
        onClose={() => setDeletingService(null)}
        onConfirm={handleConfirmDelete}
        title={t('managerAudit.archiveService')}
        message={t('managerAudit.archiveConfirm', { name: deletingService?.name })}
        confirmText={t('managerAudit.archiveService')}
        variant="danger"
      />
    </div>
  );
}
