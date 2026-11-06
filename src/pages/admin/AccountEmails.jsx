import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { accountEmailService } from '../../services/accountEmail.service';
import { supabase } from '../../lib/supabase';
import './AdminPages.css';

export default function AccountEmails() {
  const { t }=useTranslation(); const tr=key=>t(`accountEmail.${key}`); const navigate=useNavigate();
  const [page,setPage]=useState(1);const [users,setUsers]=useState([]);const [hasMore,setHasMore]=useState(false);
  const [selected,setSelected]=useState('');const [newEmail,setNewEmail]=useState('');const [confirmEmail,setConfirmEmail]=useState('');const [reason,setReason]=useState('');const [acknowledged,setAcknowledged]=useState(false);
  const [loading,setLoading]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  const target=users.find(user=>user.id===selected);
  const errorText=code=>tr(`errors.${['EMAIL_IN_USE','EMAIL_UNCHANGED','EMAIL_CHANGED_REFRESH','INVALID_DETAILS','FORBIDDEN','ADMIN_MFA_REQUIRED','AUTH_REQUIRED','SESSION_ENDED'].includes(code)?code:'UNAVAILABLE'}`);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setSelected('');
    accountEmailService.list(page).then(result=>{if(active){setUsers(result.users);setHasMore(result.hasMore);}}).catch(failure=>{if(active)setError(errorText(failure.message));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[page]);
  const submit=async event=>{
    event.preventDefault();if(busy || !target)return;setError('');setSuccess('');
    const address=newEmail.trim().toLowerCase();
    if(address!==confirmEmail.trim().toLowerCase() || !acknowledged || reason.trim().length<8){setError(tr('errors.INVALID_DETAILS'));return;}
    setBusy(true);
    try{
      const result=await accountEmailService.change({userId:target.id,expectedEmail:target.email || '',newEmail:address,reason});
      if(result.signedOut){await supabase.auth.signOut({scope:'local'});navigate('/login',{replace:true});return;}
      setUsers(items=>items.map(user=>user.id===target.id?{...user,email:result.email}:user));setSuccess(tr('changed'));setNewEmail('');setConfirmEmail('');setReason('');setAcknowledged(false);
    }catch(failure){setError(errorText(failure.message));}finally{setBusy(false);}
  };
  return <div className="admin-page"><div className="admin-page-header"><Link className="admin-back-link" to="/admin/users">{t('admin.users.title')}</Link><h1>{tr('title')}</h1><p>{tr('description')}</p></div>
    <form className="password-reset-form" onSubmit={submit}>
      <label htmlFor="email-account">{tr('account')}</label><select id="email-account" className="form-input" value={selected} disabled={loading || busy} onChange={event=>{setSelected(event.target.value);setNewEmail('');setConfirmEmail('');setReason('');setAcknowledged(false);setSuccess('');setError('');}} required>
        <option value="">{t(loading?'common.loading':'admin.passwordReset.select')}</option>{users.map(user=><option key={user.id} value={user.id}>{user.email || user.name || user.id} ({user.role || '—'})</option>)}
      </select>
      <div className="password-reset-pagination"><button className="btn btn-secondary" type="button" disabled={page===1 || loading || busy} onClick={()=>setPage(value=>value-1)}>{t('admin.passwordReset.previous')}</button><span>{t('admin.passwordReset.page',{page})}</span><button className="btn btn-secondary" type="button" disabled={!hasMore || loading || busy} onClick={()=>setPage(value=>value+1)}>{t('admin.passwordReset.next')}</button></div>
      {target && <p>{tr('currentEmail')}: <bdi>{target.email || '—'}</bdi></p>}
      <label htmlFor="admin-new-email">{tr('newEmail')}</label><input id="admin-new-email" className="form-input" type="email" dir="ltr" maxLength={254} value={newEmail} onChange={event=>setNewEmail(event.target.value)} disabled={busy || !target} required />
      <label htmlFor="admin-confirm-email">{tr('confirmEmail')}</label><input id="admin-confirm-email" className="form-input" type="email" dir="ltr" maxLength={254} value={confirmEmail} onChange={event=>setConfirmEmail(event.target.value)} disabled={busy || !target} required />
      <label htmlFor="email-change-reason">{tr('reason')}</label><textarea id="email-change-reason" className="form-input" minLength={8} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} disabled={busy || !target} required />
      <label><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)} disabled={busy || !target} required /> {tr('acknowledge')}</label>
      {error && <p role="alert" className="password-reset-error">{error}</p>}{success && <p role="status">{success}</p>}
      <button className="btn btn-primary" disabled={busy || loading || !target} type="submit">{t(busy?'common.saving':'common.save')}</button>
    </form></div>;
}
