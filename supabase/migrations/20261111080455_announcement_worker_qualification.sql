begin;
create or replace function private.admin_push_worker(p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare runtime private.announcement_runtime;result jsonb;saved_delivery private.announcement_deliveries;status integer;reason text;
begin
 select * into runtime from private.announcement_runtime where singleton;
 if p_action='configuration'then return private.customer_push_configuration()||jsonb_build_object('announcementEnabled',runtime.enabled,'deliveryMode',runtime.mode,'announcementApiUrl',runtime.api_url);end if;
 if p_action='configure'then
  if jsonb_typeof(p_data->'enabled')is distinct from'boolean'or p_data->>'mode'not in('capture','apns')or p_data->>'apiUrl'is distinct from(select api_url from private.customer_push_runtime where singleton)then raise exception 'INVALID_REQUEST';end if;
  update private.announcement_runtime set enabled=(p_data->>'enabled')::boolean,mode=p_data->>'mode',api_url=p_data->>'apiUrl'where singleton;return jsonb_build_object('configured',true);
 end if;
 if not runtime.enabled and p_action<>'finish'then raise exception 'DELIVERY_DISABLED';end if;
 if p_action='claim'then
  -- An expired lease may have reached Apple. Never resend an uncertain delivery.
  update private.announcement_deliveries set state='unknown',last_error='LeaseExpired',finished_at=clock_timestamp()where state='sending'and leased_until<now();
  update private.announcement_deliveries j set state='skipped',last_error='NoLongerEligible',finished_at=clock_timestamp()
   from private.announcement_campaigns c where j.campaign_id=c.id and c.state='queued'and j.state='pending'and not private.announcement_delivery_allowed(j.id);
  with candidates as(select d.id from private.announcement_deliveries d join private.announcement_campaigns c on c.id=d.campaign_id
   where c.state='queued'and d.state='pending'and d.available_at<=now()order by d.available_at,d.id for update of d skip locked limit greatest(1,least(coalesce((p_data->>'limit')::integer,20),20))),
  leased as(update private.announcement_deliveries d set state='sending',delivery_mode=runtime.mode,attempts=attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes'from candidates c where d.id=c.id returning d.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'lease',l.lease_id,'campaignId',c.id,'recipientBinding',l.recipient_binding,'deliveryMode',l.delivery_mode,'token',d.token,'environment',d.environment,'topic',d.topic,'language',d.language,
   'titleEn',c.title_en,'bodyEn',c.body_en,'titleAr',c.title_ar,'bodyAr',c.body_ar,'destination',c.destination,'expiresAt',extract(epoch from c.expires_at)::bigint)),'[]')into result
   from leased l join private.announcement_campaigns c on c.id=l.campaign_id join private.customer_push_devices d on d.id=l.device_id;
  return result;
 elsif p_action='validate'then
  return to_jsonb(exists(select 1 from private.announcement_deliveries d where d.id=(p_data->>'id')::uuid and d.lease_id=(p_data->>'lease')::uuid and d.state='sending'and d.leased_until>now()and runtime.enabled and d.delivery_mode=runtime.mode and private.announcement_delivery_allowed(d.id)));
 elsif p_action='finish'then
  select * into saved_delivery from private.announcement_deliveries where id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid and state='sending'for update;
  if not found then return 'false'::jsonb;end if;
  status:=(p_data->>'status')::integer;reason:=left(coalesce(p_data->>'reason',''),80);
  if reason='NoLongerEligible'then update private.announcement_deliveries set state='skipped',last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=saved_delivery.id;
  elsif status=200 then update private.announcement_deliveries set state=case when saved_delivery.delivery_mode='capture'then'captured'else'accepted'end,provider_status=status,provider_id=left(p_data->>'providerId',100),finished_at=clock_timestamp(),leased_until=null where id=saved_delivery.id;
  elsif status in(429,500,503)and saved_delivery.attempts<3 then update private.announcement_deliveries set state='pending',available_at=now()+make_interval(secs=>30*power(2,saved_delivery.attempts)::integer),last_error=reason,provider_status=status,leased_until=null where id=saved_delivery.id;
  else
   update private.announcement_deliveries set state=case when status=0 then'unknown'else'failed'end,provider_status=status,last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=saved_delivery.id;
   if status=410 or reason in('BadDeviceToken','Unregistered','DeviceTokenNotForTopic')then
    update private.customer_push_devices set permission=false,token=null where id=saved_delivery.device_id and extensions.digest(token,'sha256')=saved_delivery.token_hash;
   end if;
  end if;
  return 'true'::jsonb;
 end if;
 raise exception 'INVALID_REQUEST';
end $$;

notify pgrst,'reload schema';
commit;
