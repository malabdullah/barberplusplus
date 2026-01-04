import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Reusable back link component with icon and label
 * @param {object} props
 * @param {string} props.to - The route to navigate to
 * @param {string} [props.label] - Optional label (defaults to translated "Back")
 * @param {string} [props.className] - Optional additional CSS class
 */
export const BackLink = ({ to, label, className = '' }) => {
  const { t } = useTranslation();

  return (
    <Link to={to} className={`back-link ${className}`.trim()} aria-label={label || t('common.back')}>
      <ArrowLeft size={20} aria-hidden="true" />
      <span>{label || t('common.back')}</span>
    </Link>
  );
};

export default BackLink;
