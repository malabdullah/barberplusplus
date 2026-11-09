import React from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './ServicePicker.css';

export default function ServicePicker({ services, selectedIds, onToggle, label, includedIds = [], disabled = false, isOptionDisabled, invalid = false, describedBy }) {
  const { t, i18n } = useTranslation();
  const arabic = i18n.language.startsWith('ar');
  return <fieldset className={`service-picker${invalid ? ' service-picker-invalid' : ''}`} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={describedBy}>
    <legend>{label || t('services.title')}</legend>
    <div className="service-picker-options">
      {services.map(service => {
        const selected = selectedIds.includes(service.id);
        const included = includedIds.includes(service.id);
        const locked = included || Boolean(isOptionDisabled?.(service));
        return <label key={service.id} className={`service-picker-row${selected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}>
          <input type="checkbox" checked={selected} disabled={locked} onChange={() => onToggle(service.id)} />
          <span className="service-picker-check" aria-hidden="true">{selected && <Check size={14} strokeWidth={2.5} />}</span>
          <span className="service-picker-copy"><strong>{(arabic && (service.nameAr || service.name_ar)) || service.name}</strong><span>{service.duration} {t('common.min')}</span></span>
          <span className={`service-picker-price${included ? ' is-included' : ''}`}>{included ? t('packages.included') : <bdi>{Number(service.price).toFixed(3)} {t('common.currency')}</bdi>}</span>
        </label>;
      })}
    </div>
  </fieldset>;
}
