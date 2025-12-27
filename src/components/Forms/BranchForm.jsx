import React, { useState, useEffect } from 'react';
import { Copy, Camera, Building2 } from 'lucide-react';
import { GCC_COUNTRIES } from '../../constants/countries';
import { DAYS, DEFAULT_SCHEDULE } from '../../constants/time';
import { locationsService } from '../../services';
import './Forms.css';

const DEFAULT_HOURS = DEFAULT_SCHEDULE;

export default function BranchForm({ branch, onSubmit, onCancel, isSubmitting = false }) {
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
    if (!formData.name.trim()) newErrors.name = 'Branch name is required';
    if (!formData.locationUrl.trim()) newErrors.locationUrl = 'Location URL is required';
    if (!formData.governorateId) newErrors.governorateId = 'Governorate is required';
    if (!formData.areaId) newErrors.areaId = 'Area is required';
    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone is required';
    } else {
      const country = GCC_COUNTRIES.find(c => c.code === formData.countryCode);
      if (country && !country.pattern.test(formData.phone.replace(/\s/g, ''))) {
        newErrors.phone = `Invalid ${country.label.split(' ')[0]} phone number`;
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
        <h4 className="form-section-title">Branch Image</h4>

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
            Upload Photo
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
        <h4 className="form-section-title">Basic Information</h4>

        <div className="form-group">
          <label className="form-label">Branch Name</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className={`form-input ${errors.name ? 'error' : ''}`}
            placeholder="e.g., Downtown Studio"
          />
          {errors.name && <span className="form-error">{errors.name}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">Arabic Branch Name</label>
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
          <label className="form-label">Location URL</label>
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
            <label className="form-label">Governorate</label>
            <select
              name="governorateId"
              value={formData.governorateId}
              onChange={handleChange}
              className={`form-input form-select ${errors.governorateId ? 'error' : ''}`}
              disabled={loadingLocations}
            >
              <option value="">{loadingLocations ? 'Loading...' : 'Select governorate...'}</option>
              {governorates.map((gov) => (
                <option key={gov.id} value={gov.id}>
                  {gov.name_en}
                </option>
              ))}
            </select>
            {errors.governorateId && <span className="form-error">{errors.governorateId}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">Area</label>
            <select
              name="areaId"
              value={formData.areaId}
              onChange={handleChange}
              className={`form-input form-select ${errors.areaId ? 'error' : ''}`}
              disabled={!formData.governorateId || loadingLocations}
            >
              <option value="">Select area...</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name_en}
                </option>
              ))}
            </select>
            {errors.areaId && <span className="form-error">{errors.areaId}</span>}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Phone</label>
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
          <label className="form-label">Number of Barbers</label>
          <input
            type="number"
            name="numberOfBarbers"
            value={formData.numberOfBarbers}
            onChange={handleChange}
            className="form-input"
            min="1"
            placeholder="e.g., 5"
          />
        </div>
      </div>

      <div className="form-section">
        <h4 className="form-section-title">Operating Hours</h4>

        <div className="hours-editor">
          {DAYS.map(({ key, label }) => {
            const dayHours = formData.openingHours[key];
            const isClosed = !dayHours?.open;

            return (
              <div key={key} className="hours-row-edit">
                <span className="hours-day-label">{label}</span>
                <div className="hours-inputs">
                  {isClosed ? (
                    <span className="hours-closed-label">Closed</span>
                  ) : (
                    <>
                      <input
                        type="time"
                        value={dayHours?.open || ''}
                        onChange={(e) => handleHoursChange(key, 'open', e.target.value)}
                        className="form-input time-input"
                      />
                      <span className="hours-separator">to</span>
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
                  {isClosed ? 'Set Hours' : 'Close'}
                </button>
                <button
                  type="button"
                  className="hours-copy-btn"
                  onClick={() => copyHoursToAll(key)}
                  title="Copy to all days"
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
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : (branch ? 'Save Changes' : 'Create Branch')}
        </button>
      </div>
    </form>
  );
}
