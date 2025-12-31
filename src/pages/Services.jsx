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
import './Services.css';

function ServiceForm({ service, onSubmit, onCancel, isSubmitting = false }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: service?.name || '',
    description: service?.description || '',
    duration: service?.duration || 30,
    price: service?.price || 0,
  });

  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'duration' || name === 'price' ? Number(value) : value,
    }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = t('validation.serviceNameRequired');
    if (formData.duration < 5) newErrors.duration = t('validation.durationMin');
    if (formData.price < 0) newErrors.price = t('validation.priceNegative');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label className="form-label">{t('services.name')}</label>
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          className={`form-input ${errors.name ? 'error' : ''}`}
          placeholder={t('services.namePlaceholder')}
        />
        {errors.name && <span className="form-error">{errors.name}</span>}
      </div>

      <div className="form-group">
        <label className="form-label">{t('common.description')}</label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          className="form-input form-textarea"
          placeholder={t('services.descriptionPlaceholder')}
          rows={3}
        />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{t('services.duration')}</label>
          <input
            type="number"
            name="duration"
            value={formData.duration}
            onChange={handleChange}
            className={`form-input ${errors.duration ? 'error' : ''}`}
            min="5"
            step="5"
          />
          {errors.duration && <span className="form-error">{errors.duration}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">{t('services.price')} ({t('common.currency')})</label>
          <input
            type="number"
            name="price"
            value={formData.price}
            onChange={handleChange}
            className={`form-input ${errors.price ? 'error' : ''}`}
            min="0"
            step="1"
          />
          {errors.price && <span className="form-error">{errors.price}</span>}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? t('common.loading') : (service ? t('common.saveChanges') : t('services.addService'))}
        </button>
      </div>
    </form>
  );
}

const ServiceCard = memo(function ServiceCard({ service, onEdit, onDelete, t }) {
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
        <h3 className="service-name">{service.name}</h3>
        {service.description && (
          <p className="service-description">{service.description}</p>
        )}

        <div className="service-details">
          <div className="detail-item">
            <Clock size={16} strokeWidth={1.5} />
            <span>{service.duration} {t('common.min')}</span>
          </div>
          <div className="detail-item price">
            <span>{service.price} {t('common.currency')}</span>
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
              title={t('services.deleteService')}
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
  const { t } = useTranslation();
  const { branchServices, selectedBranch, addService, updateService, deleteService } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [deletingService, setDeletingService] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const filteredServices = useMemo(() =>
    branchServices.filter((service) =>
      service.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [branchServices, searchQuery]
  );

  const handleAdd = useCallback(() => {
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
      console.error('Error saving service:', err);
      setError(err.message || 'Failed to save service. Please try again.');
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
        console.error('Error deleting service:', err);
        setError(err.message || 'Failed to delete service. Please try again.');
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
        <button className="btn btn-primary" onClick={handleAdd}>
          <Plus size={18} strokeWidth={2} />
          {t('services.addService')}
        </button>
      </div>

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
          <button className="btn btn-primary" onClick={handleAdd}>
            <Plus size={18} strokeWidth={2} />
            {t('services.addFirstService')}
          </button>
        </div>
      )}

      {/* Service Form Modal */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingService(null); }}
        title={editingService ? t('services.editService') : t('services.addNewService')}
      >
        {error && (
          <div className="form-error-banner" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--status-error-bg)', color: 'var(--status-error)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
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
        title={t('services.deleteService')}
        message={t('services.deleteConfirm', { name: deletingService?.name })}
        confirmText={t('services.deleteService')}
        variant="danger"
      />
    </div>
  );
}
