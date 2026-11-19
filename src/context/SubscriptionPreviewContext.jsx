import React, { createContext, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const Context = createContext(null);
const initialCodes = [
  { code: 'WELCOME20', type: 'percent', value: 20, eligibility: 'monthly', duration: 'once', expiresOn: '2026-12-31', limit: null, used: 0, enabled: true },
  { code: 'YEAR20', type: 'percent', value: 20, eligibility: 'yearly', duration: 'once', expiresOn: '2026-12-31', limit: null, used: 0, enabled: true },
  { code: 'PRIVATE10', type: 'fixed', value: 10000, eligibility: 'both', duration: 'once', expiresOn: '2026-12-31', limit: 1, used: 1, enabled: true },
];
const initialBusinesses = [
  { id: 'atlas', name: 'atlas', count: 6, frequency: 'monthly', status: 'active', until: '2026-12-01', manager: 'nasser', managers: ['nasser', 'omar'], shops: [{id:'sharq',name:'sharq'},{id:'salmiya',name:'salmiya'}], grant: null, history: [] },
  { id: 'coast', name: 'coast', count: 3, frequency: 'monthly', status: 'trial', until: '2026-11-28', manager: 'ali', managers: ['ali'], shops: [{id:'coast-shop',name:'coast'}], grant: null, history: [] },
  { id: 'classic', name: 'classic', count: 4, frequency: 'monthly', status: 'expired', until: '2026-11-12', manager: 'hassan', managers: ['hassan','yousef'], shops: [{id:'classic-shop',name:'classic'}], grant: null, history: [] },
  { id: 'city', name: 'city', count: 2, frequency: 'monthly', status: 'grace', until: '2026-11-21', manager: 'khaled', managers: ['khaled'], shops: [{id:'city-shop',name:'city'}], grant: null, history: [] },
  { id: 'mirqab', name: 'mirqab', count: 5, frequency: 'yearly', status: 'expired', until: '2026-11-01', manager: 'fahad', managers: ['fahad'], shops: [{id:'mirqab-shop',name:'mirqab'}], grant: {type:'full',startsOn:'2026-11-16',endsOn:'2026-11-26',shopIds:[],reason:'Demo goodwill access'}, history: [] },
  { id: 'farwaniya', name: 'farwaniya', count: 3, frequency: 'monthly', status: 'expired', until: '2026-11-14', manager: 'salem', managers: ['salem'], shops: [{id:'farwaniya-shop',name:'farwaniya'}], grant: {type:'manual',startsOn:'2026-11-18',endsOn:'2026-11-25',shopIds:['farwaniya-shop'],reason:'Demo manual booking exception'}, history: [] },
];

export function SubscriptionPreviewProvider({ children }) {
  const { i18n } = useTranslation();
  const [language, setLanguage] = useState(i18n.resolvedLanguage?.startsWith('ar') ? 'ar' : 'en');
  const [theme, setTheme] = useState('light');
  const [businesses, setBusinesses] = useState(initialBusinesses);
  const [codes, setCodes] = useState(initialCodes);
  const t = useMemo(() => i18n.getFixedT(language), [i18n, language]);
  const bp = (key, options) => t(`billingPreview.${key}`, options);
  const sp = (key, options) => t(`subscriptionDesign.${key}`, options);
  const money = fils => `${bp('currency')} ${(fils / 1000).toFixed(3)}`;
  const date = value => new Intl.DateTimeFormat(language === 'ar' ? 'ar-KW' : 'en-GB', {
    day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kuwait',
  }).format(new Date(`${value}T12:00:00+03:00`));
  const updateBusiness = (id, update, action, reason) => setBusinesses(current => current.map(business => business.id !== id ? business : {
    ...business, ...update,
    history: [{id:crypto.randomUUID(),action,reason,at:new Date().toISOString()}, ...business.history],
  }));
  return <Context.Provider value={{language,setLanguage,theme,setTheme,businesses,codes,setCodes,updateBusiness,t,bp,sp,money,date}}>{children}</Context.Provider>;
}

export function useSubscriptionPreview() {
  const value = useContext(Context);
  if (!value) throw new Error('Subscription design context is unavailable.');
  return value;
}
