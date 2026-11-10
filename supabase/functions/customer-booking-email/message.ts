export type BookingEmailJob = { id:string; lease:string; kind:'received'|'confirmed'|'rescheduled'|'cancelled'|'updated'; message:{
 email:string;guest:boolean;language:string;reference:string;date:string;time:string;duration:number;price:number;status:string;
 shop:string;shopAr?:string;barber:string;barberAr?:string;services?:{name:string;name_ar?:string}[];
 package?:{name?:string;name_ar?:string}|null;cancellationReason?:string;
} };
export type Email = {to:string[];from:string;reply_to:string;subject:string;html:string;text:string};
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function bookingEmail(job:BookingEmailJob,appUrl:string):Email {
 if(!['https://www.barberplusplus.com','https://barber-test.alabdullah-cs.workers.dev'].includes(appUrl))throw Error('InvalidApp');
 const m=job.message,ar=m.language==='ar';
 if(!m.email || m.email.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(m.email))throw Error('InvalidRecipient');
 const headings={received:['Booking request received','تم استلام طلب الحجز'],confirmed:['Your booking is confirmed','تم تأكيد حجزك'],
  rescheduled:['Your booking has been rescheduled','تم تغيير موعد حجزك'],cancelled:['Your booking has been cancelled','تم إلغاء حجزك'],updated:['Your booking has been updated','تم تحديث حجزك']};
 if(!headings[job.kind])throw Error('InvalidKind');
 const heading=headings[job.kind][ar?1:0];
 const date=new Intl.DateTimeFormat(ar?'ar-KW':'en-GB',{dateStyle:'full',timeZone:'Asia/Kuwait'}).format(new Date(m.date+'T12:00:00+03:00'));
 const time=new Intl.DateTimeFormat(ar?'ar-KW':'en-GB',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Asia/Kuwait'}).format(new Date(m.date+'T'+m.time+':00+03:00'));
 const rows=[
  [ar?'رقم الحجز':'Reference',m.reference],
  [ar?'الصالون':'Shop',ar&&m.shopAr?m.shopAr:m.shop],
  [ar?'الحلاق':'Barber',ar&&m.barberAr?m.barberAr:m.barber],
  [ar?'التاريخ':'Date',date],[ar?'الوقت':'Time',time+(ar?' (توقيت الكويت)':' (Kuwait time)')],
  [ar?'الخدمات':'Services',(m.services||[]).map(s=>ar&&s.name_ar?s.name_ar:s.name).join(ar?'، ':', ')],
  [ar?'المدة':'Duration',String(m.duration)+(ar?' دقيقة':' min')],
  [ar?'الإجمالي':'Total',(ar?'د.ك ':'KWD ')+Number(m.price).toFixed(3)],
 ];
 if(m.package?.name)rows.push([ar?'الباقة':'Package',ar&&m.package.name_ar?m.package.name_ar:m.package.name]);
 if(job.kind==='cancelled'&&m.cancellationReason)rows.push([ar?'سبب الإلغاء':'Cancellation reason',m.cancellationReason]);
 const action=m.guest?(ar?'احجز موعداً':'Book an appointment'):(ar?'مواعيدي':'My appointments');
 const url=appUrl+(m.guest?'/book':'/customer/account');
 const text=['Barber++',heading,...rows.map(([label,value])=>label+': '+value),action+': '+url,'support@barberplusplus.com'].join('\n');
 const html=`<!doctype html><html lang="${ar?'ar':'en'}" dir="${ar?'rtl':'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f7f5ef;color:#242320;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto;background:#fffdf8;border:1px solid #dfd5bd;border-radius:16px"><tr><td style="padding:28px"><div dir="ltr" style="font-weight:bold;font-size:26px">Barber<span style="color:#bc8d32">++</span></div><h1 style="font-size:24px;line-height:1.4">${escape(heading)}</h1><table width="100%" cellpadding="0" cellspacing="0">${rows.map(([label,value])=>`<tr><td style="padding:12px 0;border-bottom:1px solid #eee8dc;color:#666;vertical-align:top;width:34%">${escape(label)}</td><td style="padding:12px 8px;border-bottom:1px solid #eee8dc">${escape(value)}</td></tr>`).join('')}</table><p style="margin:28px 0"><a href="${escape(url)}" style="display:inline-block;padding:14px 24px;border-radius:8px;background:#d1a74f;color:#191919;text-decoration:none;font-weight:bold">${escape(action)}</a></p><a href="mailto:support@barberplusplus.com" style="color:#805d20">support@barberplusplus.com</a></td></tr></table></td></tr></table></body></html>`;
 return {from:'Barber++ <noreply@barberplusplus.com>',reply_to:'support@barberplusplus.com',to:[m.email],subject:heading+' · '+m.reference,html,text};
}
