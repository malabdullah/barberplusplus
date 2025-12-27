import React, { useState, useEffect } from 'react';
import { Camera } from 'lucide-react';
import { GCC_COUNTRIES } from '../../constants/countries';
import './Forms.css';

export default function BarberForm({ barber, services = [], onSubmit, onCancel, isSubmitting = false }) {
  const [formData, setFormData] = useState({
    name: barber?.name || '',
    nameAr: barber?.nameAr || '',
    email: barber?.email || '',
    countryCode: barber?.countryCode || '+965',
    phone: barber?.phone || '',
    profilePicture: barber?.profilePicture || barber?.avatarUrl || null, // Existing URL
    profilePictureFile: null, // New file to upload
    isActive: barber?.isActive ?? true,
    services: barber?.services || [],
  });

  const [errors, setErrors] = useState({});

  // Detect user's country via IP geolocation
  useEffect(() => {
    if (!barber?.countryCode) {
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
  }, [barber?.countryCode]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    setFormData((prev) => ({ ...prev, [name]: newValue }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Create object URL for preview (more efficient than base64)
      const previewUrl = URL.createObjectURL(file);
      setFormData(prev => ({
        ...prev,
        profilePicture: previewUrl,
        profilePictureFile: file,
      }));
    }
  };

  const toggleService = (serviceId) => {
    setFormData(prev => ({
      ...prev,
      services: prev.services.includes(serviceId)
        ? prev.services.filter(id => id !== serviceId)
        : [...prev.services, serviceId]
    }));
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = 'Name is required';
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }
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
      onSubmit(formData);
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-section">
        <h4 className="form-section-title">Profile</h4>

        <div className="profile-picture-upload">
          <div className="profile-picture-preview">
            {formData.profilePicture ? (
              <img src={formData.profilePicture} alt="Profile" />
            ) : (
              <div className="profile-picture-placeholder">
                {formData.name ? formData.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'BB'}
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
          <label className="form-checkbox">
            <input
              type="checkbox"
              name="isActive"
              checked={formData.isActive}
              onChange={handleChange}
            />
            <span>Active</span>
          </label>
          <span className="form-hint">Inactive barbers won't appear in booking options</span>
        </div>

        <div className="form-group">
          <label className="form-label">Full Name</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className={`form-input ${errors.name ? 'error' : ''}`}
            placeholder="e.g., John Smith"
          />
          {errors.name && <span className="form-error">{errors.name}</span>}
        </div>

        <div className="form-group">
          <label className="form-label">Arabic Full Name</label>
          <input
            type="text"
            name="nameAr"
            value={formData.nameAr}
            onChange={handleChange}
            className="form-input"
            placeholder="مثال: جون سميث"
            dir="rtl"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Email</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            className={`form-input ${errors.email ? 'error' : ''}`}
            placeholder="barber@example.com"
          />
          {errors.email && <span className="form-error">{errors.email}</span>}
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
      </div>

      <div className="form-section">
        <h4 className="form-section-title">Assigned Services</h4>

        {services.length > 0 ? (
          <div className="services-select">
            {services.map((service) => (
              <label key={service.id} className="service-checkbox">
                <input
                  type="checkbox"
                  checked={formData.services.includes(service.id)}
                  onChange={() => toggleService(service.id)}
                />
                <span>{service.name}</span>
                <span className="service-price">{service.price} KWD</span>
              </label>
            ))}
          </div>
        ) : (
          <span className="form-hint">No services available. Add services to the branch first.</span>
        )}
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : (barber ? 'Save Changes' : 'Add Barber')}
        </button>
      </div>
    </form>
  );
}
