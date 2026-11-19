import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import PreviewShell, { PreviewDialog, PreviewHeading } from '../components/Subscriptions/PreviewShell';
import { useSubscriptionPreview } from '../context/SubscriptionPreviewContext';
import { PREVIEW_TODAY, previewAccess, previewFixedFils, previewQuote, validatePreviewGrant } from '../utils/subscriptionPreview';

const statuses = ['active','trial','grace','expired','complimentary','manual'];
const newCode = {code:'',type:'percent',value:'20',eligibility:'monthly',duration:'once',expiresOn:'2026-12-31',limit:'',reason:''};

export default function AdminSubscriptionsPreview({ codesOnly = false }) {
  const {businessId} = useParams();
  const {businesses,codes,setCodes,updateBusiness,language,bp,sp,money,date} = useSubscriptionPreview();
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState('all');
  const [page,setPage] = useState(1);
  const [dialog,setDialog] = useState(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [reason,setReason] = useState('');
  const [manager,setManager] = useState('');
  const [grant,setGrant] = useState({type:'full',startsOn:PREVIEW_TODAY,endsOn:'2026-11-26',shopIds:[],reason:''});
  const [codeForm,setCodeForm] = useState(newCode);
  const [codeTarget,setCodeTarget] = useState(null);
  const business = businesses.find(item=>item.id===businessId);
  const selectedCode = codes.find(item=>item.code===codeTarget);
  useEffect(()=>{setDialog(null);setError('');setNotice('');},[businessId,codesOnly]);
  const activeDialog = ['grant','transfer','remove-grant'].includes(dialog) ? (business ? dialog : null)
    : ['code-toggle','code-history'].includes(dialog) ? (selectedCode ? dialog : null) : dialog;
  const title = codesOnly ? sp('discountCodes') : business ? sp(`businessNames.${business.name}`) : sp('subscriptions');
  const people = key => sp(`people.${key}`);
  const businessName = item => sp(`businessNames.${item.name}`);
  const close = () => { setDialog(null);setError(''); };
  const open = type => { setError('');setReason('');setNotice('');setDialog(type); };
  const statusBadge = status => <span className={`subscription-status status-${status}`}>{sp(`states.${status}`)}</span>;
  const filtered = codesOnly ? codes.filter(item=>item.code.includes(query.toUpperCase().trim())&&(filter==='all'||item.eligibility===filter)) : businesses.filter(item=>
    `${businessName(item)} ${people(item.manager)} ${item.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())&&(filter==='all'||previewAccess(item)===filter));
  const size = codesOnly ? 10 : 5;
  const pages = Math.max(1,Math.ceil(filtered.length/size));
  const safePage = Math.min(page,pages);
  const rows = filtered.slice((safePage-1)*size,safePage*size);
  const announce = key => {setNotice(sp(key));close();};
  const commitGrant = event => {
    event.preventDefault();
    const invalid = validatePreviewGrant(grant,business);
    if(invalid){setError(invalid);return;}
    updateBusiness(business.id,{grant:{...grant,shopIds:grant.type==='full'?[]:grant.shopIds,reason:grant.reason.trim()}},'grantSaved',grant.reason.trim());
    announce('accessSaved');
  };
  const commitTransfer = event => {
    event.preventDefault();
    if(!reason.trim()){setError('reasonRequired');return;}
    if(manager===business.manager||!business.managers.includes(manager)){setError('managerRequired');return;}
    updateBusiness(business.id,{manager},'managerTransferred',reason.trim());announce('transferSaved');
  };
  const saveCode = event => {
    event.preventDefault();
    const normalized=codeForm.code.trim().toUpperCase();
    if(!/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(normalized)){setError('invalidCode');return;}
    if(codes.some(item=>item.code===normalized)){setError('duplicateCode');return;}
    const value=codeForm.type==='fixed'?previewFixedFils(codeForm.value):Number(codeForm.value);
    if(value===null||!Number.isSafeInteger(value)||value<1||(codeForm.type==='percent'&&value>100)){setError('invalidDiscount');return;}
    const limit=codeForm.limit===''?null:Number(codeForm.limit);
    if(limit!==null&&(!Number.isSafeInteger(limit)||limit<1)){setError('invalidLimit');return;}
    if(!codeForm.expiresOn||codeForm.expiresOn<PREVIEW_TODAY){setError('invalidCodeDate');return;}
    if(codeForm.duration==='threeMonthly'&&codeForm.eligibility!=='monthly'){setError('codeIneligible');return;}
    if(!codeForm.reason.trim()){setError('reasonRequired');return;}
    setCodes(current=>[...current,{...codeForm,code:normalized,value,limit,enabled:true,used:0,history:[{action:'codeCreated',reason:codeForm.reason.trim(),at:new Date().toISOString()}]}]);
    announce('codeSaved');
  };
  const commitToggle = event => {
    event.preventDefault();
    if(!reason.trim()){setError('reasonRequired');return;}
    setCodes(current=>current.map(item=>item.code!==selectedCode.code?item:{...item,enabled:!item.enabled,history:[{action:item.enabled?'codePaused':'codeEnabled',reason:reason.trim(),at:new Date().toISOString()},...(item.history||[])]}));
    announce('codeUpdated');
  };
  const pagination = <div className="subscription-pagination"><span>{sp('resultCount',{count:filtered.length})}</span><div><button className="billing-icon" type="button" disabled={safePage===1} aria-label={sp('previousPage')} onClick={()=>setPage(safePage-1)}><ChevronLeft size={19}/></button><span>{sp('pageCount',{page:safePage,pages})}</span><button className="billing-icon" type="button" disabled={safePage===pages} aria-label={sp('nextPage')} onClick={()=>setPage(safePage+1)}><ChevronRight size={19}/></button></div></div>;
  const auditList = entries => entries.length ? <ol className="subscription-history">{entries.map((entry,index)=><li key={entry.id||index}><div><strong>{sp(entry.action)}</strong><time dateTime={entry.at}>{new Intl.DateTimeFormat(language==='ar'?'ar-KW':'en-GB',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kuwait'}).format(new Date(entry.at))}</time></div><p>{entry.reason}</p><span>{sp('adminPreview')}</span></li>)}</ol> : <p className="subscription-empty">{sp('noChanges')}</p>;
  const errorMessage = error && <p className="subscription-error" role="alert">{sp(error)}</p>;
  const reasonInput = <label className="subscription-field">{sp('reason')}<textarea value={reason} onChange={event=>setReason(event.target.value)} maxLength={240} rows={3} required/></label>;

  return <PreviewShell active={codesOnly?'codes':'subscriptions'} admin><main className="billing-main subscription-main">
    {businessId&&<Link className="subscription-back" to="/design/subscriptions"><ArrowLeft size={16}/>{sp('subscriptions')}</Link>}
    <PreviewHeading title={title}/>
    <p className="subscription-notice" role="status">{notice}</p>
    {businessId&&!business ? <div className="subscription-empty"><p>{sp('businessMissing')}</p><Link className="billing-secondary" to="/design/subscriptions">{sp('backToList')}</Link></div> : business ? <>
      <section className="subscription-admin-summary" aria-label={bp('currentSubscription')}>
        <div className="billing-price"><div><strong><bdi>{money(previewQuote(business.count,business.frequency).subtotal)}</bdi></strong><span>{bp(business.frequency==='monthly'?'perMonth':'perYear')}</span></div><p>{bp('activeBarbers',{count:business.count})}</p></div>
        <div>{statusBadge(previewAccess(business))}<p className="subscription-subtle">{sp('renewalOrExpiry')} · {date(['complimentary','manual'].includes(previewAccess(business))?business.grant.endsOn:business.until)}</p></div>
        <button className="billing-primary" type="button" onClick={()=>{setGrant(business.grant?{...business.grant,startsOn:PREVIEW_TODAY,reason:''}:{type:'full',startsOn:PREVIEW_TODAY,endsOn:'2026-11-26',shopIds:[],reason:''});open('grant');}}>{sp('manageAccess')}</button>
      </section>
      <section className="subscription-admin-section"><h2>{sp('businessDetails')}</h2><dl className="billing-review-rows"><div><dt>{bp('billingManager')}</dt><dd>{people(business.manager)}<button className="billing-text-button" type="button" onClick={()=>{setManager('');open('transfer');}}>{sp('transfer')}</button></dd></div><div><dt>{sp('branches')}</dt><dd>{business.shops.map(shop=>sp(`shopNames.${shop.name}`)).join(' · ')}</dd></div><div><dt>{bp('billingFrequency')}</dt><dd>{bp(business.frequency)}</dd></div></dl></section>
      <section className="subscription-admin-section"><div className="subscription-section-heading"><h2>{sp('accessException')}</h2>{business.grant&&<button className="billing-text-button subscription-danger" type="button" onClick={()=>open('remove-grant')}>{sp('removeException')}</button>}</div>
        {business.grant?<dl className="billing-review-rows"><div><dt>{sp('accessType')}</dt><dd>{sp(business.grant.type==='full'?'fullAccess':'manualAccess')}</dd></div><div><dt>{sp('period')}</dt><dd>{date(business.grant.startsOn)} – {date(business.grant.endsOn)}{business.grant.startsOn>PREVIEW_TODAY&&<span className="subscription-scheduled">{sp('scheduled')}</span>}</dd></div>{business.grant.type==='manual'&&<div><dt>{sp('branches')}</dt><dd>{business.shops.filter(shop=>business.grant.shopIds.includes(shop.id)).map(shop=>sp(`shopNames.${shop.name}`)).join(' · ')}</dd></div>}<div><dt>{sp('reason')}</dt><dd>{business.grant.reason}</dd></div></dl>:<p className="subscription-empty">{sp('noException')}</p>}
      </section>
      <section className="subscription-admin-section"><h2>{sp('history')}</h2>{auditList(business.history)}</section>
    </> : <>
      <div className="subscription-list-tools"><label className="subscription-search"><Search size={18} aria-hidden="true"/><span className="billing-sr-only">{sp(codesOnly?'searchCodes':'searchBusinesses')}</span><input type="search" value={query} placeholder={sp(codesOnly?'searchCodes':'searchBusinesses')} onChange={event=>{setQuery(event.target.value);setPage(1);}}/></label>
        <label className="subscription-filter"><span className="billing-sr-only">{sp(codesOnly?'eligibility':'accessStatus')}</span><select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">{sp(codesOnly?'allFrequencies':'allStatuses')}</option>{(codesOnly?['monthly','yearly','both']:statuses).map(value=><option key={value} value={value}>{codesOnly?sp(`eligibilityOptions.${value}`):sp(`states.${value}`)}</option>)}</select></label>
        {codesOnly?<button className="billing-primary" type="button" onClick={()=>{setCodeForm(newCode);open('new-code');}}><Plus size={18}/>{sp('newCode')}</button>:<Link className="billing-secondary" to="/design/discounts">{sp('discountCodes')}</Link>}
      </div>
      {rows.length ? <div className="subscription-list" role="region" aria-label={title} tabIndex={0}><table><caption className="billing-sr-only">{title}</caption><thead>{codesOnly?<tr><th scope="col">{sp('code')}</th><th scope="col">{sp('discount')}</th><th scope="col">{sp('eligibility')}</th><th scope="col">{sp('duration')}</th><th scope="col">{sp('redemptions')}</th><th scope="col">{sp('expires')}</th><th scope="col">{bp('status')}</th><th scope="col"><span className="billing-sr-only">{sp('actions')}</span></th></tr>:<tr><th scope="col">{sp('business')}</th><th scope="col">{bp('billingManager')}</th><th scope="col">{sp('barbers')}</th><th scope="col">{sp('price')}</th><th scope="col">{sp('accessStatus')}</th><th scope="col">{sp('renewalOrExpiry')}</th><th scope="col"><span className="billing-sr-only">{sp('actions')}</span></th></tr>}</thead><tbody>{codesOnly?rows.map(item=><tr key={item.code}><td><strong>{item.code}</strong></td><td>{item.type==='percent'?`${item.value}%`:money(item.value)}</td><td>{sp(`eligibilityOptions.${item.eligibility}`)}</td><td>{sp(item.duration==='threeMonthly'?'threeMonthly':'firstPayment')}</td><td>{item.used} / {item.limit??sp('unlimited')}</td><td>{date(item.expiresOn)}</td><td>{statusBadge(item.enabled?'enabled':'paused')}</td><td><button className="billing-text-button" type="button" onClick={()=>{setCodeTarget(item.code);open('code-toggle');}}>{sp(item.enabled?'pause':'enable')}</button><button className="billing-text-button" type="button" onClick={()=>{setCodeTarget(item.code);open('code-history');}}>{sp('history')}</button></td></tr>):rows.map(item=><tr key={item.id}><td><Link className="subscription-business-link" to={`/design/subscriptions/${item.id}`}>{businessName(item)}</Link></td><td>{people(item.manager)}</td><td>{item.count}</td><td><bdi>{money(previewQuote(item.count,item.frequency).subtotal)}</bdi><small>{bp(item.frequency)}</small></td><td>{statusBadge(previewAccess(item))}</td><td>{date(['complimentary','manual'].includes(previewAccess(item))?item.grant.endsOn:item.until)}</td><td><Link className="billing-icon" to={`/design/subscriptions/${item.id}`} aria-label={sp('viewBusiness',{name:businessName(item)})}><ArrowRight size={18}/></Link></td></tr>)}</tbody></table></div>:<div className="subscription-empty"><p>{sp('noResults')}</p><button type="button" className="billing-text-button" onClick={()=>{setQuery('');setFilter('all');setPage(1);}}>{sp('clearFilters')}</button></div>}
      <ul className="subscription-mobile-list">{rows.map(item=>codesOnly?<li key={item.code}><div><strong>{item.code}</strong>{statusBadge(item.enabled?'enabled':'paused')}</div><dl><div><dt>{sp('discount')}</dt><dd>{item.type==='percent'?`${item.value}%`:money(item.value)}</dd></div><div><dt>{sp('eligibility')}</dt><dd>{sp(`eligibilityOptions.${item.eligibility}`)}</dd></div><div><dt>{sp('duration')}</dt><dd>{sp(item.duration==='threeMonthly'?'threeMonthly':'firstPayment')}</dd></div><div><dt>{sp('expires')}</dt><dd>{date(item.expiresOn)}</dd></div><div><dt>{sp('redemptions')}</dt><dd>{item.used} / {item.limit??sp('unlimited')}</dd></div></dl><div><button className="billing-text-button" type="button" onClick={()=>{setCodeTarget(item.code);open('code-toggle');}}>{sp(item.enabled?'pause':'enable')}</button><button className="billing-text-button" type="button" onClick={()=>{setCodeTarget(item.code);open('code-history');}}>{sp('history')}</button></div></li>:<li key={item.id}><div><Link className="subscription-business-link" to={`/design/subscriptions/${item.id}`}>{businessName(item)}</Link>{statusBadge(previewAccess(item))}</div><dl><div><dt>{bp('billingManager')}</dt><dd>{people(item.manager)}</dd></div><div><dt>{sp('barbers')}</dt><dd>{item.count}</dd></div><div><dt>{sp('price')}</dt><dd><bdi>{money(previewQuote(item.count,item.frequency).subtotal)}</bdi> / {bp(item.frequency)}</dd></div><div><dt>{sp('renewalOrExpiry')}</dt><dd>{date(['complimentary','manual'].includes(previewAccess(item))?item.grant.endsOn:item.until)}</dd></div></dl><Link className="billing-text-button" to={`/design/subscriptions/${item.id}`} aria-label={sp('viewBusiness',{name:businessName(item)})}>{sp('manageAccess')}<ArrowRight size={16}/></Link></li>)}</ul>
      {pagination}
    </>}

    {activeDialog&&<PreviewDialog wide={dialog==='new-code'} title={sp(dialog==='grant'?'manageAccess':dialog==='transfer'?'transferBilling':dialog==='remove-grant'?'removeException':dialog==='new-code'?'newCode':dialog==='code-toggle'?(selectedCode.enabled?'pauseCode':'enableCode'):'history')} onClose={close}>
      {dialog==='grant'&&<form className="subscription-form" onSubmit={commitGrant}>
        <label className="subscription-field">{sp('accessType')}<select value={grant.type} onChange={event=>setGrant({...grant,type:event.target.value})}><option value="full">{sp('fullAccess')}</option><option value="manual">{sp('manualAccess')}</option></select></label>
        <div className="subscription-form-pair"><label className="subscription-field">{sp('startsOn')}<input type="date" min={PREVIEW_TODAY} value={grant.startsOn} required onChange={event=>setGrant({...grant,startsOn:event.target.value})}/></label><label className="subscription-field">{sp('endsOn')}<input type="date" min={grant.startsOn} value={grant.endsOn} required onChange={event=>setGrant({...grant,endsOn:event.target.value})}/></label></div>
        {grant.type==='manual'&&<fieldset className="subscription-shop-choices"><legend>{sp('branches')}</legend>{business.shops.map(shop=><label key={shop.id}><input type="checkbox" checked={grant.shopIds.includes(shop.id)} onChange={event=>setGrant({...grant,shopIds:event.target.checked?[...grant.shopIds,shop.id]:grant.shopIds.filter(id=>id!==shop.id)})}/>{sp(`shopNames.${shop.name}`)}</label>)}</fieldset>}
        <label className="subscription-field">{sp('reason')}<textarea rows={3} value={grant.reason} required maxLength={240} onChange={event=>setGrant({...grant,reason:event.target.value})}/></label>
        {errorMessage}<p className="billing-dialog-caption">{sp('accessDisclosure')}</p><button className="billing-primary billing-dialog-primary" type="submit">{sp('savePreview')}</button>
      </form>}
      {dialog==='transfer'&&<form className="subscription-form" onSubmit={commitTransfer}><p>{sp('transferCurrent',{name:people(business.manager)})}</p><label className="subscription-field">{sp('newBillingManager')}<select value={manager} required onChange={event=>setManager(event.target.value)}><option value="">{sp('selectManager')}</option>{business.managers.filter(id=>id!==business.manager).map(id=><option key={id} value={id}>{people(id)}</option>)}</select></label>{reasonInput}{errorMessage}<p className="billing-dialog-caption">{sp('transferDisclosure')}</p><button className="billing-primary billing-dialog-primary" type="submit" disabled={!business.managers.some(id=>id!==business.manager)}>{sp('savePreview')}</button></form>}
      {dialog==='remove-grant'&&<form className="subscription-form" onSubmit={event=>{event.preventDefault();if(!reason.trim()){setError('reasonRequired');return;}updateBusiness(business.id,{grant:null},'grantRemoved',reason.trim());announce('accessRemoved');}}><p>{sp('removeDisclosure')}</p>{reasonInput}{errorMessage}<button className="billing-danger-button billing-dialog-primary" type="submit">{sp('removePreview')}</button></form>}
      {dialog==='new-code'&&<form className="subscription-form" onSubmit={saveCode}>
        <label className="subscription-field">{sp('code')}<input value={codeForm.code} autoCapitalize="characters" maxLength={24} required onChange={event=>setCodeForm({...codeForm,code:event.target.value.toUpperCase()})}/></label>
        <div className="subscription-form-pair"><label className="subscription-field">{sp('discountType')}<select value={codeForm.type} onChange={event=>setCodeForm({...codeForm,type:event.target.value})}><option value="percent">{sp('percentage')}</option><option value="fixed">{sp('fixedAmount')}</option></select></label><label className="subscription-field">{sp(codeForm.type==='percent'?'percentageValue':'fixedValue')}<input value={codeForm.value} type="number" step={codeForm.type==='percent'?'1':'0.001'} min={codeForm.type==='percent'?'1':'0.001'} max={codeForm.type==='percent'?'100':undefined} required onChange={event=>setCodeForm({...codeForm,value:event.target.value})}/></label></div>
        <div className="subscription-form-pair"><label className="subscription-field">{sp('eligibility')}<select value={codeForm.eligibility} onChange={event=>setCodeForm({...codeForm,eligibility:event.target.value,duration:event.target.value==='monthly'?codeForm.duration:'once'})}>{['monthly','yearly','both'].map(value=><option key={value} value={value}>{sp(`eligibilityOptions.${value}`)}</option>)}</select></label><label className="subscription-field">{sp('duration')}<select value={codeForm.duration} onChange={event=>setCodeForm({...codeForm,duration:event.target.value})}><option value="once">{sp('firstPayment')}</option>{codeForm.eligibility==='monthly'&&<option value="threeMonthly">{sp('threeMonthly')}</option>}</select></label></div>
        <div className="subscription-form-pair"><label className="subscription-field">{sp('expires')}<input type="date" min={PREVIEW_TODAY} required value={codeForm.expiresOn} onChange={event=>setCodeForm({...codeForm,expiresOn:event.target.value})}/></label><label className="subscription-field">{sp('redemptionLimit')}<input type="number" min="1" step="1" value={codeForm.limit} placeholder={sp('unlimited')} onChange={event=>setCodeForm({...codeForm,limit:event.target.value})}/></label></div>
        <p className="billing-dialog-caption">{sp('oncePerBusiness')}</p><label className="subscription-field">{sp('reason')}<textarea value={codeForm.reason} required rows={2} maxLength={240} onChange={event=>setCodeForm({...codeForm,reason:event.target.value})}/></label>{errorMessage}<button className="billing-primary billing-dialog-primary" type="submit">{sp('createPreview')}</button>
      </form>}
      {dialog==='code-toggle'&&<form className="subscription-form" onSubmit={commitToggle}><p><strong>{selectedCode.code}</strong></p>{reasonInput}{errorMessage}<button className="billing-primary billing-dialog-primary" type="submit">{sp('savePreview')}</button></form>}
      {dialog==='code-history'&&auditList(selectedCode.history||[])}
    </PreviewDialog>}
  </main></PreviewShell>;
}
