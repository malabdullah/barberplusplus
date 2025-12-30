import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Camera, Building2 } from 'lucide-react';
import { GCC_COUNTRIES } from '../../constants/countries';
import { DAYS, DEFAULT_SCHEDULE } from '../../constants/time';
import { locationsService } from '../../services';
import './Forms.css';

const DEFAULT_HOURS = DEFAULT_SCHEDULE;

export default function BranchForm({ branch, onSubmit, onCancel, isSubmitting = false }) {
  const { t, i18n } = useTranslation();
  const [formData, setFormData] = useState({
    name: branch?.name || '',
    nameAr: branch?.nameAr || '',
    locationUrl: branch?.locationUrl || '',
    governorateId: branch?.governorateId || '',
    areaId: branch?.areaId || '',
    countryCode: branch?.countryCode || '+965',
    phone: branch?.phone || '',
    numberOfBarbers: branch?.numberOfBarbers || '',
    openingHours: branch?.openingHours || DEFAULT_HOURS,
    imageUrl: branch?.imageUrl || null, // Existing URL
    imageFile: null, // New file to upload
  });

  const [errors, setErrors] = useState({});
  const [governorates, setGovernorates] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(true);

  // Fetch governorates with areas on mount
  useEffect(() => {
    locationsService.getGovernoratesWithAreas()
      .then(data => {
        setGovernorates(data);
        setLoadingLocations(false);
        // If editing and governorate is set, populate areas
        if (branch?.governorateId) {
          const gov = data.find(g => g.id === branch.governorateId);
          setAreas(gov?.areas || []);
        }
      })
      .catch(err => {
        console.error('Error fetching locations:', err);
        setLoadingLocations(false);
      });
  }, [branch?.governorateId]);

  // Detect user's country via IP geolocation
  useEffect(() => {
    if (!branch?.countryCode) {
      fetch('http://ip-api.com/json/?fields=countryCode')
        .then(res => res.json())
        .then(data => {
          const country = GCC_COUNTRIES.find(c => c.country === data.countryCode);
          if (country) {
            setFormData(prev => ({ ...prev, countryCode: country.code }));
          }
        })
        .catch(() => {}); // Silently fail, keep Kuwait default
    }
  }, [branch?.countryCode]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'governorateId') {
      const govId = value ? parseInt(value, 10) : '';
      setFormData((prev) => ({ ...prev, governorateId: govId, areaId: '' }));
      // Update areas based on selected governorate
      const gov = governorates.find(g => g.id === govId);
      setAreas(gov?.areas || []);
      if (errors.areaId) {
        setErrors((prev) => ({ ...prev, areaId: null }));
      }
    } else if (name === 'areaId') {
      setFormData((prev) => ({ ...prev, [name]: value ? parseInt(value, 10) : '' }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const handleHoursChange = (day, field, value) => {
    setFormData((prev) => ({
      ...prev,
      openingHours: {
        ...prev.openingHours,
        [day]: {
          ...prev.openingHours[day],
          [field]: value || null,
        },
      },
    }));
  };

  const toggleDayClosed = (day) => {
    const isClosed = !formData.openingHours[day]?.open;
    setFormData((prev) => ({
      ...prev,
      openingHours: {
        ...prev.openingHours,
        [day]: isClosed
          ? { open: '09:00', close: '18:00' }
          : { open: null, close: null },
      },
    }));
  };

  const copyHoursToAll = (sourceDay) => {
    const sourceHours = formData.openingHours[sourceDay];
    const newHours = {};
    DAYS.forEach(({ key }) => {
      newHours[key] = { ...sourceHours };
    });
    setFormData((prev) => ({ ...prev, openingHours: newHours }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Create object URL for preview
      const previewUrl = URL.createObjectURL(file);
      setFormData((prev) => ({
        ...prev,
        imageUrl: previewUrl,
        imageFile: file,
      }));
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = t('validation.branchNameRequired');
    if (!formData.locationUrl.trim()) newErrors.locationUrl = t('validation.locationUrlRequired');
    if (!formData.governorateId) newErrors.governorateId = t('validation.governorateRequired');
    if (!formData.areaId) newErrors.areaId = t('validation.areaRequired');
    if (!formData.phone.trim()) {
      newErrors.phone = t('validation.phoneRequired');
    } else {
      const country = GCC_COUNTRIES.find(c => c.code === formData.countryCode);
      if (country && !country.pattern.test(formData.phone.replace(/\s/g, ''))) {
        newErrors.phone = t('validation.invalidPhone');
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      // Include governorate and area names for display
      const selectedGovernorate = governorates.find(g => g.id === formData.governorateId);
      const selectedArea = areas.find(a => a.id === formData.areaId);

      onSubmit({
        ...formData,
        governorateName: selectedGovernorate?.name_en || '',
        governorateNameAr: selectedGovernorate?.name_ar || '',
        areaName: selectedArea?.name_en || '',
        areaNameAr: selectedArea?.name_ar || '',
      });
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-section">
        <h4 className="form-section-title">{t('branches.image')}</h4>

        <div className="profile-picture-upload">
          <div className="profile-picture-preview branch-image-preview">
            {formData.imageUrl ? (
              <img src={formData.imageUrl} alt="Branch" />
            ) : (
              <div className="profile-picture-placeholder">
                <Building2 size={32} strokeWidth={1.5} />
              </div>
            )}
          </div>
          <label className="profile-picture-button">
            <Camera size={16} strokeWidth={1.5} />
            {t('branches.uploadImage')}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      <div className="form-section">
        <h4 className="form-section-title">{t('branches.basicInfo')}</h4>

        <div className="form-group">
          <label className="form-label">{t('branches.name')}</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className={`form-input ${errors.name ? 'error' : ''}`}
            placeholder={t('branches.namePlaceholder')}
          />
          {errors.name && <span className="form-error">{errors.name}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">{t('branches.nameAr')}</label>
          <input
            type="text"
            name="nameAr"
            value={formData.nameAr}
            onChange={handleChange}
            className="form-input"
            placeholder="مثال: استوديو وسط المدينة"
            dir="rtl"
          />
        </div>

        <div className="form-group">
          <label className="form-label">{t('branches.locationUrl')}</label>
          <input
            type="url"
            name="locationUrl"
            value={formData.locationUrl}
            onChange={handleChange}
            className={`form-input ${errors.locationUrl ? 'error' : ''}`}
            placeholder="https://maps.google.com/..."
          />
          {errors.locationUrl && <span className="form-error">{errors.locationUrl}</span>}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('branches.governorate')}</label>
            <select
              name="governorateId"
              value={formData.governorateId}
              onChange={handleChange}
              className={`form-input form-select ${errors.governorateId ? 'error' : ''}`}
              disabled={loadingLocations}
            >
              <option value="">{loadingLocations ? t('common.loading') : t('branches.selectGovernorate')}</option>
              {governorates.map((gov) => (
                <option key={gov.id} value={gov.id}>
                  {i18n.language === 'ar' ? gov.name_ar : gov.name_en}
                </option>
              ))}
            </select>
            {errors.governorateId && <span className="form-error">{errors.governorateId}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">{t('branches.area')}</label>
            <select
              name="areaId"
              value={formData.areaId}
              onChange={handleChange}
              className={`form-input form-select ${errors.areaId ? 'error' : ''}`}
              disabled={!formData.governorateId || loadingLocations}
            >
              <option value="">{t('branches.selectArea')}</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {i18n.language === 'ar' ? area.name_ar : area.name_en}
                </option>
              ))}
            </select>
            {errors.areaId && <span className="form-error">{errors.areaId}</span>}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('common.phone')}</label>
          <div className="phone-input-group">
            <select
              name="countryCode"
              value={formData.countryCode}
              onChange={handleChange}
              className="form-input form-select country-code-select"
            >
              {GCC_COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.label}
                </option>
              ))}
            </select>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              className={`form-input phone-number-input ${errors.phone ? 'error' : ''}`}
              placeholder="XXXX XXXX"
            />
          </div>
          {errors.phone && <span className="form-error">{errors.phone}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">{t('branches.numberOfBarbers')}</label>
          <input
            type="number"
            name="numberOfBarbers"
            value={formData.numberOfBarbers}
            onChange={handleChange}
            className="form-input"
            min="1"
            placeholder={t('branches.numberOfBarbersPlaceholder')}
          />
        </div>
      </div>

      <div className="form-section">
        <h4 className="form-section-title">{t('branches.operatingHours')}</h4>

        <div className="hours-editor">
          {DAYS.map(({ key, label, labelAr }) => {
            const dayHours = formData.openingHours[key];
            const isClosed = !dayHours?.open;

            return (
              <div key={key} className="hours-row-edit">
                <span className="hours-day-label">{i18n.language === 'ar' ? labelAr : label}</span>
                <div className="hours-inputs">
                  {isClosed ? (
                    <span className="hours-closed-label">{t('availability.closed')}</span>
                  ) : (
                    <>
                      <input
                        type="time"
                        value={dayHours?.open || ''}
                        onChange={(e) => handleHoursChange(key, 'open', e.target.value)}
                        className="form-input time-input"
                      />
                      <span className="hours-separator">{t('branches.to')}</span>
                      <input
                        type="time"
                        value={dayHours?.close || ''}
                        onChange={(e) => handleHoursChange(key, 'close', e.target.value)}
                        className="form-input time-input"
                      />
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className={`hours-toggle ${isClosed ? 'closed' : 'open'}`}
                  onClick={() => toggleDayClosed(key)}
                >
                  {isClosed ? t('branches.setHours') : t('branches.close')}
                </button>
                <button
                  type="button"
                  className="hours-copy-btn"
                  onClick={() => copyHoursToAll(key)}
                  title={t('branches.copyToAll')}
                >
                  <Copy size={14} strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? t('common.loading') : (branch ? t('common.saveChanges') : t('branches.createBranch'))}
        </button>
      </div>
    </form>
  );
}
