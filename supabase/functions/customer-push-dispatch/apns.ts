export type PushJob = {
  id:string; lease:string; eventId:string; bookingId:string; kind:string; actor:string;
  token:string; environment:string; topic:string; language:string;
  date:string; time:string; shop:string; shopAr?:string; barber:string; barberAr?:string; expiresAt:number; cancellationReason?:string|null;
};
export function pushContent(job:PushJob) {
  const ar=job.language==='ar';
  const language=ar?'ar-KW':'en-KW';
  const date=new Date(`${job.date}T${job.time}:00+03:00`);
  const day=new Intl.DateTimeFormat(language,{weekday:'short',month:'short',day:'numeric',timeZone:'Asia/Kuwait'}).format(date);
  const time=new Intl.DateTimeFormat(language,{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Asia/Kuwait'}).format(date);
  const shop=ar?(job.shopAr||job.shop):job.shop;
  const titles:Record<string,[string,string]>={
    confirmed:['Booking confirmed','تم تأكيد الحجز'],
    rescheduled:['Your appointment has a new time','تم تغيير موعدك'],
    cancelled:job.actor==='customer'?['Booking cancelled','تم إلغاء الحجز']:['The shop cancelled your booking','ألغى الصالون حجزك'],
    updated:['Booking details changed','تم تحديث تفاصيل الحجز'],
    reminder24:['Your appointment is tomorrow','موعدك غدًا'],
    reminder2:['Your appointment is coming up','اقترب موعدك'],
    review:['How was your visit?','كيف كانت زيارتك؟'],
  };
  const reason=job.kind==='cancelled' && job.actor!=='customer' && typeof job.cancellationReason==='string'
    ? Array.from(job.cancellationReason.replace(/[\s\p{Cc}]+/gu,' ').trim()).slice(0,300).join('') : '';
  const summary=`${shop} · ${day} · ${time}`;
  const body=reason?`${summary}\n${ar?'السبب':'Reason'}: ${reason}`:summary;
  return {aps:{alert:{title:(titles[job.kind]||titles.updated)[ar?1:0],
    body:job.kind==='review'?(ar?`قيّم زيارتك إلى ${shop}`:`Rate your visit to ${shop}`):body},
    sound:'default','thread-id':`booking.${job.bookingId}`,category:'BOOKING_UPDATE'},
    version:1,bookingId:job.bookingId,eventId:job.eventId,kind:job.kind};
}

const b64=(data:Uint8Array)=>btoa(String.fromCharCode(...data)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const cachedTokens = new Map<string, { value: string; created: number }>();
export async function apnsToken(pem:string,keyId:string,teamId:string) {
  const now=Math.floor(Date.now()/1000);
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pem))),x=>x.toString(16).padStart(2,'0')).join('');
  const identity=keyId+':'+teamId+':'+fingerprint;
  const cached = cachedTokens.get(identity);
  if(cached && now-cached.created<2400) return cached.value;
  const raw=atob(pem.replace(/-----[^-]+-----|\s/g,''));
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(raw,c=>c.charCodeAt(0)),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const encoder=new TextEncoder();
  const data=b64(encoder.encode(JSON.stringify({alg:'ES256',kid:keyId})))+'.'+b64(encoder.encode(JSON.stringify({iss:teamId,iat:now})));
  const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(data)));
  const value=data+'.'+b64(signature);
  if (cachedTokens.size >= 4) cachedTokens.delete(cachedTokens.keys().next().value!);
  cachedTokens.set(identity, { value, created: now });
  return value;
}

export async function sendAPNs(job:PushJob,jwt:string,send:typeof fetch=fetch,
  runtime:{topic:string;environments:string[]}) {
  if(!['sandbox','production'].includes(job.environment) || !runtime.environments.includes(job.environment)
    || job.topic!==runtime.topic || !/^[0-9a-f]{32,512}$/.test(job.token) || job.token.length%2) return {status:400,reason:'EnvironmentMismatch',apnsId:''};
  const host=job.environment==='sandbox'?'api.sandbox.push.apple.com':'api.push.apple.com';
  try {
    const response=await send(`https://${host}/3/device/${job.token}`,{
      method:'POST',headers:{authorization:`bearer ${jwt}`,'apns-topic':job.topic,'apns-push-type':'alert',
        'apns-priority':'10','apns-id':job.id,'apns-collapse-id':`${job.bookingId}:${job.kind}`,
        'apns-expiration':String(job.expiresAt),'content-type':'application/json'},
      body:JSON.stringify(pushContent(job)),signal:AbortSignal.timeout(10000),
    });
    const error=response.ok?null:await response.json().catch(()=>null);
    return {status:response.status,reason:String(error?.reason||''),apnsId:response.headers.get('apns-id')||job.id};
  } catch { return {status:0,reason:'TransportUnavailable',apnsId:''}; }
}
