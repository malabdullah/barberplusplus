-- Keep the lock/backfill/trigger installation atomic in CLI and SQL runners.
begin;

-- One international contact number per customer, staff identity or shop.
-- Customer account/business records are representations of one contact; their
-- booking ownership and live-session checks remain independent of the phone.
create function private.canonical_phone(p_phone text, p_country_code text default '+965', p_international boolean default false)
returns text language plpgsql immutable set search_path='' as $$
declare
  value text := trim(translate(coalesce(p_phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'));
  digits text;
  country text := regexp_replace(coalesce(nullif(p_country_code,''),'+965'),'[^0-9]','','g');
begin
  value := replace(replace(value,chr(8206),''),chr(8207),'');
  if value='' then return null; end if;
  if value !~ '^[+0-9[:space:]().-]+$' or value ~ '.+[+]' then
    raise exception using errcode='22023',message='INVALID_PHONE';
  end if;
  digits := regexp_replace(value,'[^0-9]','','g');
  if left(value,1)='+' or p_international then null;
  elsif left(digits,2)='00' then digits:=substr(digits,3);
  elsif not (left(digits,length(country))=country and length(digits)>10) then digits:=country||digits;
  end if;
  -- A domestic trunk prefix is not part of the international number.
  if left(digits,4) in ('9660','9710') then digits:=left(digits,3)||substr(digits,5); end if;
  if digits !~ '^[1-9][0-9]{6,14}$' then raise exception using errcode='22023',message='INVALID_PHONE'; end if;
  return '+'||digits;
end;
$$;
revoke all on function private.canonical_phone(text,text,boolean) from public,anon,authenticated,service_role;

create table private.phone_numbers (
  phone text primary key,
  owner_key text not null,
  customer_user_id uuid,
  customer_record_id uuid
);
create table private.phone_sources (
  source text not null,
  record_id uuid not null,
  phone text not null references private.phone_numbers(phone),
  customer_user_id uuid,
  customer_record_id uuid,
  primary key(source,record_id)
);
create index phone_sources_phone_idx on private.phone_sources(phone);
alter table private.phone_numbers enable row level security;
alter table private.phone_sources enable row level security;
revoke all on private.phone_numbers,private.phone_sources from public,anon,authenticated,service_role;

create function private.release_phone_source(p_phone text)
returns void language plpgsql set search_path='' as $$
declare remaining_user uuid; remaining_record uuid;
begin
  perform 1 from private.phone_numbers where phone=p_phone for update;
  if not exists(select 1 from private.phone_sources where phone=p_phone) then
    delete from private.phone_numbers where phone=p_phone;
  else
    select customer_user_id into remaining_user from private.phone_sources where phone=p_phone and customer_user_id is not null limit 1;
    select customer_record_id into remaining_record from private.phone_sources where phone=p_phone and customer_record_id is not null limit 1;
    update private.phone_numbers set customer_user_id=remaining_user,customer_record_id=remaining_record where phone=p_phone;
  end if;
end;
$$;
revoke all on function private.release_phone_source(text) from public,anon,authenticated,service_role;

create function private.sync_phone_record(p_source text,p_id uuid,p_row jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  entries jsonb := '[]'; entry jsonb; old_phone text; target_phone text;
  source_names text[]; owner_key text; customer_user uuid; customer_record uuid;
  claimed text; sources_owner uuid;
begin
  if p_source='auth.users' then
    source_names:=array['auth.profile','auth.phone'];
    if p_row is not null and p_row->>'deleted_at' is null then
      if p_row->'raw_app_meta_data'->>'role'='customer' then
        owner_key:='customer';customer_user:=p_id;
      else owner_key:='user:'||p_id::text;
      end if;
      target_phone:=private.canonical_phone(p_row->>'phone','',true);
      if target_phone is not null then entries:=entries||jsonb_build_array(jsonb_build_object('source','auth.phone','phone',target_phone)); end if;
      if owner_key<>'customer' then
        target_phone:=private.canonical_phone(p_row->'raw_user_meta_data'->>'phone',coalesce(p_row->'raw_user_meta_data'->>'countryCode',p_row->'raw_user_meta_data'->>'country_code','+965'));
        if target_phone is not null then entries:=entries||jsonb_build_array(jsonb_build_object('source','auth.profile','phone',target_phone)); end if;
      end if;
    end if;
  elsif p_source in ('customers','customer_accounts','barbers','branches') then
    source_names:=array[p_source];
    if p_row is not null then
      target_phone:=private.canonical_phone(p_row->>'phone',p_row->>'country_code');
      if p_source='customer_accounts' then
        owner_key:='customer';customer_user:=p_id;
      elsif p_source='customers' then
        owner_key:='customer';customer_record:=p_id;
      elsif p_source='branches' then owner_key:='shop:'||p_id::text;
      else
        sources_owner:=nullif(p_row->>'user_id','')::uuid;
        if sources_owner is not null and not exists(select 1 from auth.users where id=sources_owner and raw_app_meta_data->>'role'='barber' and deleted_at is null) then
          raise exception 'INVALID_BARBER_ACCOUNT';
        end if;
        owner_key:=case when sources_owner is null then 'barber:'||p_id::text else 'user:'||sources_owner::text end;
      end if;
      if target_phone is not null then entries:=jsonb_build_array(jsonb_build_object('source',p_source,'phone',target_phone)); end if;
    end if;
  else raise exception 'INVALID_PHONE_SOURCE';
  end if;
  -- Stable advisory lock order avoids swaps deadlocking; the primary key and
  -- conditional UPSERT below also enforce ownership across MVCC snapshots.
  for target_phone in
    select phone from (
      select phone from private.phone_sources where source=any(source_names) and record_id=p_id
      union select value->>'phone' from jsonb_array_elements(entries)
    ) phones order by phone
  loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('barber-phone:'||target_phone,0)); end loop;

  for old_phone in delete from private.phone_sources where source=any(source_names) and record_id=p_id returning phone
  loop perform private.release_phone_source(old_phone); end loop;

  for entry in select value from jsonb_array_elements(entries) loop
    target_phone:=entry->>'phone';claimed:=null;
    insert into private.phone_numbers as numbers(phone,owner_key,customer_user_id,customer_record_id)
    values(target_phone,owner_key,customer_user,customer_record)
    on conflict(phone) do update set customer_user_id=coalesce(numbers.customer_user_id,excluded.customer_user_id),
      customer_record_id=coalesce(numbers.customer_record_id,excluded.customer_record_id)
    where numbers.owner_key=excluded.owner_key
      and (numbers.customer_user_id is null or excluded.customer_user_id is null or numbers.customer_user_id=excluded.customer_user_id)
      and (numbers.customer_record_id is null or excluded.customer_record_id is null or numbers.customer_record_id=excluded.customer_record_id)
    returning phone into claimed;
    if claimed is null then raise exception using errcode='23505',message='PHONE_IN_USE',constraint='global_phone_unique'; end if;
    insert into private.phone_sources(source,record_id,phone,customer_user_id,customer_record_id)
      values(entry->>'source',p_id,target_phone,customer_user,customer_record);
  end loop;
end;
$$;
revoke all on function private.sync_phone_record(text,uuid,jsonb) from public,anon,authenticated,service_role;

create function private.guard_global_phone()
returns trigger language plpgsql security definer set search_path='' as $$
declare record_id uuid; value jsonb; previous jsonb; source_name text; previous_user uuid;
begin
  if tg_op<>'DELETE' then value:=to_jsonb(new); end if;
  if tg_op<>'INSERT' then previous:=to_jsonb(old); end if;
  record_id:=(coalesce(value,previous)->>case when tg_table_name='customer_accounts' then 'user_id' else 'id' end)::uuid;
  source_name:=case when tg_table_schema='auth' then 'auth.users' else tg_table_name end;
  -- ON DELETE SET NULL can run before the Auth AFTER DELETE trigger. Remove
  -- the deleted user's mirror first; the barber record still owns its number.
  previous_user:=nullif(previous->>'user_id','')::uuid;
  if tg_table_name='barbers' and tg_op='UPDATE' and previous_user is not null and value->>'user_id' is null
    and not exists(select 1 from auth.users where id=previous_user) then
    perform private.sync_phone_record('auth.users',previous_user,null);
  end if;
  perform private.sync_phone_record(source_name,record_id,value);
  return null;
end;
$$;
revoke all on function private.guard_global_phone() from public,anon,authenticated,service_role;

-- Fail closed on existing conflicts. Never guess which real account should
-- keep a number or rewrite customer data as part of a production migration.
lock table auth.users,public.barbers,public.branches,public.customers,private.customer_accounts in share row exclusive mode;
do $$
declare row record;
begin
  for row in select id,jsonb_build_object('id',id,'phone',phone,'raw_user_meta_data',raw_user_meta_data,'raw_app_meta_data',raw_app_meta_data,'deleted_at',deleted_at) as value from auth.users order by id
  loop perform private.sync_phone_record('auth.users',row.id,row.value); end loop;
  for row in select id,to_jsonb(b) as value from public.barbers b order by id
  loop perform private.sync_phone_record('barbers',row.id,row.value); end loop;
  for row in select id,to_jsonb(c) as value from public.customers c order by id
  loop perform private.sync_phone_record('customers',row.id,row.value); end loop;
  for row in select user_id,to_jsonb(a) as value from private.customer_accounts a order by user_id
  loop perform private.sync_phone_record('customer_accounts',row.user_id,row.value); end loop;
  for row in select id,to_jsonb(b) as value from public.branches b order by id
  loop perform private.sync_phone_record('branches',row.id,row.value); end loop;
end;
$$;

create trigger enforce_global_phone after insert or update or delete on auth.users for each row execute function private.guard_global_phone();
create trigger enforce_global_phone after insert or update or delete on public.barbers for each row execute function private.guard_global_phone();
create trigger enforce_global_phone after insert or update or delete on public.branches for each row execute function private.guard_global_phone();
create trigger enforce_global_phone after insert or update or delete on public.customers for each row execute function private.guard_global_phone();
create trigger enforce_global_phone after insert or update or delete on private.customer_accounts for each row execute function private.guard_global_phone();

commit;
