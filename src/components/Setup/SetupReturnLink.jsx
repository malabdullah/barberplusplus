import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../context/AppContext';
import { setupReturn } from '../../utils/shopSetup';
import BackLink from '../UI/BackLink';
export default function SetupReturnLink() {
  const { t } = useTranslation(); const { search } = useLocation();
  const { branches, user, selectedBranchId, setSelectedBranchId } = useApp();
  const target = setupReturn(search, branches, user?.id);
  useEffect(() => { if (target && target.id !== selectedBranchId) setSelectedBranchId(target.id); }, [target?.id, selectedBranchId, setSelectedBranchId]);
  return target ? <BackLink to={target.path} label={t('shopSetup.back')} className="setup-return" /> : null;
}
