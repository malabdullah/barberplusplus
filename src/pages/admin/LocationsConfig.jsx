import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  MapPin,
  Plus,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  X,
  AlertTriangle,
  Map,
} from 'lucide-react';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import { adminService } from '../../services';
import { useApp } from '../../context/AppContext';
import './AdminPages.css';
import './LocationsConfig.css';

export default function LocationsConfig() {
  const { t, i18n } = useTranslation();
  const { showToast } = useApp();
  const isRTL = i18n.language === 'ar';

  const [loading, setLoading] = useState(true);
  const [governorates, setGovernorates] = useState([]);
  const [expandedGov, setExpandedGov] = useState(null);

  // Modal states
  const [govModalOpen, setGovModalOpen] = useState(false);
  const [areaModalOpen, setAreaModalOpen] = useState(false);
  const [editingGov, setEditingGov] = useState(null);
  const [editingArea, setEditingArea] = useState(null);
  const [selectedGovForArea, setSelectedGovForArea] = useState(null);

  // Form states
  const [govForm, setGovForm] = useState({ nameEn: '', nameAr: '', code: '' });
  const [areaForm, setAreaForm] = useState({ nameEn: '', nameAr: '' });
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, type: null, item: null });

  useEffect(() => {
    loadGovernorates();
  }, []);

  const loadGovernorates = async () => {
    setLoading(true);
    try {
      const data = await adminService.getGovernorates();
      setGovernorates(data);
    } catch (error) {
      console.error('Error loading governorates:', error);
      showToast?.(t('admin.locationsConfig.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (govId) => {
    setExpandedGov(expandedGov === govId ? null : govId);
  };

  // ========== Governorate CRUD ==========
  const openAddGov = () => {
    setEditingGov(null);
    setGovForm({ nameEn: '', nameAr: '', code: '' });
    setGovModalOpen(true);
  };

  const openEditGov = (gov) => {
    setEditingGov(gov);
    setGovForm({ nameEn: gov.nameEn, nameAr: gov.nameAr, code: gov.code || '' });
    setGovModalOpen(true);
  };

  const handleSaveGov = async () => {
    if (!govForm.nameEn.trim() || !govForm.nameAr.trim()) {
      showToast?.(t('admin.locationsConfig.requiredFields'), 'error');
      return;
    }

    setSaving(true);
    try {
      if (editingGov) {
        await adminService.updateGovernorate(editingGov.id, govForm);
        setGovernorates(prev =>
          prev.map(g => g.id === editingGov.id ? { ...g, ...govForm } : g)
        );
        showToast?.(t('admin.locationsConfig.governorateSaved'), 'success');
      } else {
        const newGov = await adminService.createGovernorate(govForm);
        setGovernorates(prev => [...prev, newGov]);
        showToast?.(t('admin.locationsConfig.governorateCreated'), 'success');
      }
      setGovModalOpen(false);
    } catch (error) {
      console.error('Error saving governorate:', error);
      showToast?.(t('admin.locationsConfig.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGov = async () => {
    const gov = deleteConfirm.item;
    try {
      await adminService.deleteGovernorate(gov.id);
      setGovernorates(prev => prev.filter(g => g.id !== gov.id));
      showToast?.(t('admin.locationsConfig.governorateDeleted'), 'success');
    } catch (error) {
      console.error('Error deleting governorate:', error);
      showToast?.(error.message || t('admin.locationsConfig.deleteError'), 'error');
    }
    setDeleteConfirm({ open: false, type: null, item: null });
  };

  // ========== Area CRUD ==========
  const openAddArea = (gov) => {
    setSelectedGovForArea(gov);
    setEditingArea(null);
    setAreaForm({ nameEn: '', nameAr: '' });
    setAreaModalOpen(true);
  };

  const openEditArea = (gov, area) => {
    setSelectedGovForArea(gov);
    setEditingArea(area);
    setAreaForm({ nameEn: area.nameEn, nameAr: area.nameAr });
    setAreaModalOpen(true);
  };

  const handleSaveArea = async () => {
    if (!areaForm.nameEn.trim() || !areaForm.nameAr.trim()) {
      showToast?.(t('admin.locationsConfig.requiredFields'), 'error');
      return;
    }

    setSaving(true);
    try {
      if (editingArea) {
        await adminService.updateArea(editingArea.id, areaForm);
        setGovernorates(prev =>
          prev.map(g => {
            if (g.id === selectedGovForArea.id) {
              return {
                ...g,
                areas: g.areas.map(a =>
                  a.id === editingArea.id ? { ...a, ...areaForm } : a
                ),
              };
            }
            return g;
          })
        );
        showToast?.(t('admin.locationsConfig.areaSaved'), 'success');
      } else {
        const newArea = await adminService.createArea({
          governorateId: selectedGovForArea.id,
          ...areaForm,
        });
        setGovernorates(prev =>
          prev.map(g => {
            if (g.id === selectedGovForArea.id) {
              return { ...g, areas: [...g.areas, newArea] };
            }
            return g;
          })
        );
        showToast?.(t('admin.locationsConfig.areaCreated'), 'success');
      }
      setAreaModalOpen(false);
    } catch (error) {
      console.error('Error saving area:', error);
      showToast?.(t('admin.locationsConfig.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteArea = async () => {
    const area = deleteConfirm.item;
    try {
      await adminService.deleteArea(area.id);
      setGovernorates(prev =>
        prev.map(g => ({
          ...g,
          areas: g.areas.filter(a => a.id !== area.id),
        }))
      );
      showToast?.(t('admin.locationsConfig.areaDeleted'), 'success');
    } catch (error) {
      console.error('Error deleting area:', error);
      showToast?.(error.message || t('admin.locationsConfig.deleteError'), 'error');
    }
    setDeleteConfirm({ open: false, type: null, item: null });
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-loading">
          <Loader2 size={32} className="spinning" />
          <span>{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <Link to="/admin/configuration" className="admin-back-link">
        <ArrowLeft size={16} />
        {t('admin.config.title')}
      </Link>

      <div className="admin-page-header">
        <div className="admin-page-header-row">
          <div>
            <h1>{t('admin.locationsConfig.title')}</h1>
            <p>{t('admin.locationsConfig.subtitle')}</p>
          </div>
          <div className="locations-header-actions">
            <button className="admin-refresh-btn" onClick={loadGovernorates} title={t('common.refresh')}>
              <RefreshCw size={18} />
            </button>
            <button className="btn btn-primary" onClick={openAddGov}>
              <Plus size={18} />
              {t('admin.locationsConfig.addGovernorate')}
            </button>
          </div>
        </div>
      </div>

      <div className="locations-list">
        {governorates.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty-icon">
              <Map size={32} />
            </div>
            <h3>{t('admin.locationsConfig.noGovernorates')}</h3>
            <p>{t('admin.locationsConfig.noGovernoratesDesc')}</p>
          </div>
        ) : (
          governorates.map((gov) => (
            <div key={gov.id} className="governorate-card">
              <div
                className="governorate-header"
                onClick={() => toggleExpand(gov.id)}
              >
                <div className="governorate-expand">
                  {expandedGov === gov.id ? (
                    <ChevronDown size={20} />
                  ) : (
                    <ChevronRight size={20} />
                  )}
                </div>
                <div className="governorate-icon">
                  <MapPin size={20} />
                </div>
                <div className="governorate-info">
                  <h3>{isRTL ? gov.nameAr : gov.nameEn}</h3>
                  <span className="governorate-secondary">
                    {isRTL ? gov.nameEn : gov.nameAr}
                    {gov.code && <span className="governorate-code">{gov.code}</span>}
                  </span>
                </div>
                <div className="governorate-meta">
                  <span className="area-count">
                    {gov.areas.length} {t('admin.locationsConfig.areas')}
                  </span>
                </div>
                <div className="governorate-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="admin-action-btn"
                    onClick={() => openEditGov(gov)}
                    title={t('common.edit')}
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    className="admin-action-btn danger"
                    onClick={() => setDeleteConfirm({ open: true, type: 'governorate', item: gov })}
                    title={t('common.delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {expandedGov === gov.id && (
                <div className="governorate-content">
                  <div className="areas-header">
                    <span className="areas-title">{t('admin.locationsConfig.areas')}</span>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => openAddArea(gov)}
                    >
                      <Plus size={14} />
                      {t('admin.locationsConfig.addArea')}
                    </button>
                  </div>

                  {gov.areas.length === 0 ? (
                    <div className="no-areas">
                      {t('admin.locationsConfig.noAreas')}
                    </div>
                  ) : (
                    <div className="areas-list">
                      {gov.areas.map((area) => (
                        <div key={area.id} className="area-item">
                          <div className="area-info">
                            <span className="area-name">
                              {isRTL ? area.nameAr : area.nameEn}
                            </span>
                            <span className="area-secondary">
                              {isRTL ? area.nameEn : area.nameAr}
                            </span>
                          </div>
                          <div className="area-actions">
                            <button
                              className="admin-action-btn"
                              onClick={() => openEditArea(gov, area)}
                              title={t('common.edit')}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              className="admin-action-btn danger"
                              onClick={() => setDeleteConfirm({ open: true, type: 'area', item: area })}
                              title={t('common.delete')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Governorate Modal */}
      <Modal
        isOpen={govModalOpen}
        onClose={() => setGovModalOpen(false)}
        title={editingGov ? t('admin.locationsConfig.editGovernorate') : t('admin.locationsConfig.addGovernorate')}
      >
        <div className="location-form">
          <div className="form-group">
            <label className="form-label">{t('admin.locationsConfig.nameEn')} *</label>
            <input
              type="text"
              className="form-input"
              value={govForm.nameEn}
              onChange={(e) => setGovForm({ ...govForm, nameEn: e.target.value })}
              placeholder="e.g., Al Asimah"
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('admin.locationsConfig.nameAr')} *</label>
            <input
              type="text"
              className="form-input"
              value={govForm.nameAr}
              onChange={(e) => setGovForm({ ...govForm, nameAr: e.target.value })}
              placeholder="مثال: العاصمة"
              dir="rtl"
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('admin.locationsConfig.code')}</label>
            <input
              type="text"
              className="form-input"
              value={govForm.code}
              onChange={(e) => setGovForm({ ...govForm, code: e.target.value.toUpperCase() })}
              placeholder="e.g., ASM"
              maxLength={10}
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-secondary"
              onClick={() => setGovModalOpen(false)}
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveGov}
              disabled={saving}
            >
              {saving ? <Loader2 size={16} className="spinning" /> : null}
              {editingGov ? t('common.save') : t('common.create')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Area Modal */}
      <Modal
        isOpen={areaModalOpen}
        onClose={() => setAreaModalOpen(false)}
        title={editingArea ? t('admin.locationsConfig.editArea') : t('admin.locationsConfig.addArea')}
      >
        <div className="location-form">
          {selectedGovForArea && (
            <div className="area-parent-info">
              <MapPin size={16} />
              <span>{isRTL ? selectedGovForArea.nameAr : selectedGovForArea.nameEn}</span>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">{t('admin.locationsConfig.nameEn')} *</label>
            <input
              type="text"
              className="form-input"
              value={areaForm.nameEn}
              onChange={(e) => setAreaForm({ ...areaForm, nameEn: e.target.value })}
              placeholder="e.g., Sharq"
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('admin.locationsConfig.nameAr')} *</label>
            <input
              type="text"
              className="form-input"
              value={areaForm.nameAr}
              onChange={(e) => setAreaForm({ ...areaForm, nameAr: e.target.value })}
              placeholder="مثال: شرق"
              dir="rtl"
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-secondary"
              onClick={() => setAreaModalOpen(false)}
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveArea}
              disabled={saving}
            >
              {saving ? <Loader2 size={16} className="spinning" /> : null}
              {editingArea ? t('common.save') : t('common.create')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, type: null, item: null })}
        onConfirm={deleteConfirm.type === 'governorate' ? handleDeleteGov : handleDeleteArea}
        title={deleteConfirm.type === 'governorate'
          ? t('admin.locationsConfig.deleteGovernorate')
          : t('admin.locationsConfig.deleteArea')}
        message={t('admin.locationsConfig.deleteConfirm', {
          type: deleteConfirm.type === 'governorate'
            ? t('admin.locationsConfig.governorate').toLowerCase()
            : t('admin.locationsConfig.area').toLowerCase(),
        })}
        confirmText={t('common.delete')}
        confirmVariant="danger"
      />
    </div>
  );
}
