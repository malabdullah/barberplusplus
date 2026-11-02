-- Hosted Test data only. Never include this file in production migrations.
-- Adds 5 shops per city, 2 cities per governorate, with 3 staffed barbers each.
-- Re-running preserves existing records, logins and user-edited schedules.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(61102026);

do $guard$
begin
  if to_regclass('private.cloud_test_emails') is null
     or not exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000000003'
       and email='agent@barber.test' and raw_app_meta_data->>'role'='agent' and encrypted_password<>'')
     or (select count(*) from public.governorates where id between 9101 and 9106 and code like 'TEST_%')<>6 then
    raise exception 'Refusing fixture seed outside the existing hosted Barber++ Test environment';
  end if;
  if exists(select 1 from auth.users where id::text like 'b611020%'
    and raw_app_meta_data->>'test_fixture' is distinct from 'kuwait-catalog-20261102') then
    raise exception 'Fixture identity namespace is already used by unrelated records';
  end if;
end;
$guard$;

lock table auth.users,public.branches,public.barbers,public.services in share row exclusive mode;
create temporary table seed_preserved_auth on commit drop as select id,md5(row_to_json(u)::text) fingerprint from auth.users u;
create temporary table seed_preserved_shops on commit drop as select id,md5(row_to_json(b)::text) fingerprint from public.branches b;
create temporary table seed_preserved_barbers on commit drop as select id,md5(row_to_json(b)::text) fingerprint from public.barbers b;
create temporary table seed_preserved_services on commit drop as select id,md5(row_to_json(s)::text) fingerprint from public.services s;
create temporary table seed_preserved_bookings on commit drop as select id,md5(row_to_json(b)::text) fingerprint from public.bookings b;
create temporary table seed_cities(n integer,governorate_id integer,area_id integer,name text,name_ar text,slug text) on commit drop;
insert into seed_cities values
(1,9101,92601,'Sharq','شرق','sharq'),
(2,9101,92602,'Mirqab','المرقاب','mirqab'),
(3,9102,92603,'Hawalli','حولي','hawalli'),
(4,9102,92604,'Salmiya','السالمية','salmiya'),
(5,9103,92605,'Farwaniya','الفروانية','farwaniya'),
(6,9103,92606,'Khaitan','خيطان','khaitan'),
(7,9104,92607,'Fahaheel','الفحيحيل','fahaheel'),
(8,9104,92608,'Mangaf','المنقف','mangaf'),
(9,9105,92609,'Jahra','الجهراء','jahra'),
(10,9105,92610,'Saad Al-Abdullah','سعد العبدالله','saad-al-abdullah'),
(11,9106,92611,'Sabah Al-Salem','صباح السالم','sabah-al-salem'),
(12,9106,92612,'Mubarak Al-Kabeer','مبارك الكبير','mubarak-al-kabeer');
-- Reuse an existing exact location (for example Salmiya) without rewriting it.
update seed_cities g set area_id=a.id from public.areas a
where a.governorate_id=g.governorate_id and a.name_en=g.name;
insert into public.areas(id,governorate_id,name_en,name_ar)
select area_id,governorate_id,name,name_ar from seed_cities
where not exists(select 1 from public.areas a where a.id=seed_cities.area_id);

do $seed$
declare
  city record; shop_no integer; shop_index integer; b integer; barber_no integer; s integer;
  manager_id uuid; shop_id uuid; barber_user_id uuid; barber_id uuid; service_id uuid;
  password_hash text; user_email text; contact text; user_name text;
  anchor date:=(current_timestamp at time zone 'Asia/Kuwait')::date;
  one_time_date date; vacation_start date; schedule jsonb; breaks jsonb; hours jsonb;
  day_key text; day_keys text[]:=array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  off_day text; assigned_services uuid[]; service_number integer;
  themes text[]:=array['Classic Cuts','Urban Fade','Beard Studio','Gentlemen Lounge','Express Groom'];
  themes_ar text[]:=array['قصات كلاسيكية','تدرج عصري','استوديو اللحية','مجلس الأناقة','عناية سريعة'];
  barber_names text[]:=array['Omar','Yousef','Ali'];
  barber_names_ar text[]:=array['عمر','يوسف','علي'];
  service_names text[]:=array['Classic haircut','Beard trim','Skin fade','Haircut & beard','Facial care','Wash & style'];
  service_names_ar text[]:=array['قص شعر كلاسيكي','تهذيب اللحية','تدرج الشعر','قص الشعر واللحية','عناية بالوجه','غسيل وتصفيف'];
  durations integer[]:=array[30,15,45,45,60,20];
  prices numeric[]:=array[5,2.5,7,8,10,3];
  user_row record;
begin
  -- Copy only the existing synthetic agent's password hash inside the database.
  -- No plaintext password or credential is stored in this source file.
  select encrypted_password into strict password_hash from auth.users
  where id='00000000-0000-4000-8000-000000000003' and email='agent@barber.test';
  select jsonb_object_agg(d,jsonb_build_object('open',case when d='friday' then '13:00' else '08:00' end,'close','22:00','closed',false))
  into hours from unnest(day_keys) d;

  for city in select * from seed_cities order by n loop
    for shop_index in 1..5 loop
      shop_no:=(city.n-1)*5+shop_index;
      manager_id:=('b6110201-0000-4000-8000-'||lpad(shop_no::text,12,'0'))::uuid;
      shop_id:=('b6110203-0000-4000-8000-'||lpad(shop_no::text,12,'0'))::uuid;
      user_email:='manager.'||city.slug||'.'||lpad(shop_index::text,2,'0')||'@barber.test';
      user_name:='Test '||city.name||' '||lpad(shop_index::text,2,'0')||' Manager';
      contact:='5882'||lpad(shop_no::text,4,'0');
      insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
        raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change_token_new,
        email_change,email_change_token_current,reauthentication_token,phone_change,phone_change_token,created_at,updated_at)
      values(manager_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',user_email,password_hash,now(),
        jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','manager','test_fixture','kuwait-catalog-20261102'),
        jsonb_build_object('name',user_name,'phone','+965'||contact,'countryCode','+965'),
        '','','','','','','','',now(),now()) on conflict(id) do nothing;
      insert into public.branches(id,manager_id,name,name_ar,address,city,country,country_code,phone,email,
        status,working_hours,governorate_id,area_id,location_url,number_of_barbers,image_url)
      values(shop_id,manager_id,'Test '||city.name||' — '||themes[shop_index]||' '||lpad(shop_index::text,2,'0'),
        'تجريبي '||city.name_ar||' — '||themes_ar[shop_index]||' '||lpad(shop_index::text,2,'0'),
        'Synthetic test address, Block '||shop_index||', '||city.name||', Kuwait',city.name,'Kuwait','+965',
        '5881'||lpad(shop_no::text,4,'0'),'shop.'||city.slug||'.'||lpad(shop_index::text,2,'0')||'@barber.test',
        'active',hours,city.governorate_id,city.area_id,
        'https://www.google.com/maps/search/?api=1&query='||replace(city.name,' ','%20')||'%2C%20Kuwait',3,
        case shop_index%3 when 1 then '/booking-demo/city-centre.png' when 2 then '/booking-demo/seafront.png' else '/booking-demo/market-street.png' end)
      on conflict(id) do nothing;

      for s in 1..6 loop
        service_id:=('b6110204-0000-4000-8000-'||lpad((shop_no*10+s)::text,12,'0'))::uuid;
        insert into public.services(id,branch_id,name,name_ar,description,duration,price,status)
        values(service_id,shop_id,service_names[s],service_names_ar[s],
          'Synthetic service for '||city.name||' shop '||shop_index||'; pay at the shop.',durations[s],
          prices[s]+(shop_index-1)*0.250,'active') on conflict(id) do nothing;
      end loop;

      for b in 1..3 loop
        barber_no:=(shop_no-1)*3+b;
        barber_user_id:=('b6110202-0000-4000-8000-'||lpad(barber_no::text,12,'0'))::uuid;
        barber_id:=('b6110205-0000-4000-8000-'||lpad(barber_no::text,12,'0'))::uuid;
        user_email:='barber.'||city.slug||'.'||lpad(shop_index::text,2,'0')||'.'||b||'@barber.test';
        contact:='5883'||lpad(barber_no::text,4,'0');
        user_name:=barber_names[b]||' — '||city.name||' '||lpad(shop_index::text,2,'0');
        insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
          raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change_token_new,
          email_change,email_change_token_current,reauthentication_token,phone_change,phone_change_token,created_at,updated_at)
        values(barber_user_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',user_email,password_hash,now(),
          jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','barber','test_fixture','kuwait-catalog-20261102'),
          jsonb_build_object('name',user_name,'phone','+965'||contact,'countryCode','+965'),
          '','','','','','','','',now(),now()) on conflict(id) do nothing;

        off_day:=case b when 1 then 'tuesday' when 2 then 'wednesday' else 'sunday' end;
        schedule:='{}';breaks:='[]';
        foreach day_key in array day_keys loop
          schedule:=schedule||jsonb_build_object(day_key,jsonb_build_object('enabled',day_key<>off_day,
            'start',case when day_key='friday' then '14:00' when b=1 then '09:00' when b=2 then '10:00' else '12:00' end,
            'end',case when day_key='friday' then '21:00' when b=1 then '18:00' when b=2 then '20:00' else '21:00' end));
          if day_key<>off_day then
            breaks:=breaks||jsonb_build_array(jsonb_build_object('id','seed-break-'||barber_no||'-'||day_key,
              'type','recurring','day',day_key,
              'start',case when b=1 and day_key='friday' then '15:00' when b=1 then '13:00' when b=2 then '14:30' else '16:00' end,
              'end',case when b=1 and day_key='friday' then '15:30' when b=1 then '13:30' when b=2 then '15:00' else '16:30' end,
              'reason','Test daily break / استراحة تجريبية'));
          end if;
        end loop;
        one_time_date:=anchor+2+(shop_index-1)%3;
        if lower(trim(to_char(one_time_date,'Day')))=off_day then one_time_date:=one_time_date+1;end if;
        breaks:=breaks||jsonb_build_array(jsonb_build_object('id','seed-training-'||barber_no,'type','one-time',
          'date',one_time_date::text,'start','17:00','end','18:00','reason','Test training / تدريب تجريبي'));
        vacation_start:=anchor+case b when 1 then 6 when 2 then 10 else 14 end+(shop_index-1)%3;
        assigned_services:='{}';
        foreach service_number in array case b when 1 then array[1,2,4] when 2 then array[3,2,6] else array[5,2,6] end loop
          assigned_services:=array_append(assigned_services,('b6110204-0000-4000-8000-'||lpad((shop_no*10+service_number)::text,12,'0'))::uuid);
        end loop;
        insert into public.barbers(id,user_id,branch_id,name,name_ar,email,country_code,phone,status,
          service_ids,availability,time_offs,vacations,max_booking_days,invite_status,invite_accepted_at)
        values(barber_id,barber_user_id,shop_id,user_name,barber_names_ar[b]||' — '||city.name_ar||' '||lpad(shop_index::text,2,'0'),
          user_email,'+965',contact,'active',assigned_services,schedule,breaks,
          jsonb_build_array(jsonb_build_object('id','seed-vacation-'||barber_no,'startDate',vacation_start::text,
            'endDate',(vacation_start+2)::text,'reason','Test vacation / إجازة تجريبية')),
          case b when 1 then 14 when 2 then 21 else 30 end,'accepted',now()) on conflict(id) do nothing;
      end loop;
    end loop;
  end loop;
  for user_row in select * from auth.users where raw_app_meta_data->>'test_fixture'='kuwait-catalog-20261102' loop
    insert into auth.identities(id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
    values((case user_row.raw_app_meta_data->>'role' when 'manager' then replace(user_row.id::text,'b6110201-','b6110206-')
      else replace(user_row.id::text,'b6110202-','b6110207-') end)::uuid,user_row.email,user_row.id,
      jsonb_build_object('sub',user_row.id::text,'email',user_row.email,'email_verified',true),'email',now(),now(),now())
    on conflict(id) do nothing;
    insert into public.user_settings(user_id,theme,language) values(user_row.id,'light','en') on conflict(user_id) do nothing;
  end loop;
end;
$seed$;

do $verify$
begin
  if exists(select 1 from seed_preserved_auth p left join auth.users u on u.id=p.id where u.id is null or p.fingerprint<>md5(row_to_json(u)::text))
    or exists(select 1 from seed_preserved_shops p left join public.branches b on b.id=p.id where b.id is null or p.fingerprint<>md5(row_to_json(b)::text))
    or exists(select 1 from seed_preserved_barbers p left join public.barbers b on b.id=p.id where b.id is null or p.fingerprint<>md5(row_to_json(b)::text))
    or exists(select 1 from seed_preserved_services p left join public.services s on s.id=p.id where s.id is null or p.fingerprint<>md5(row_to_json(s)::text))
    or exists(select 1 from seed_preserved_bookings p left join public.bookings b on b.id=p.id where b.id is null or p.fingerprint<>md5(row_to_json(b)::text)) then
    raise exception 'Existing Test records changed; rolling back the fixture seed';
  end if;
  if (select count(*) from public.branches where id::text like 'b6110203-%')<>60
    or (select count(*) from public.barbers where id::text like 'b6110205-%')<>180
    or (select count(*) from public.services where id::text like 'b6110204-%')<>360
    or (select count(*) from auth.users where raw_app_meta_data->>'test_fixture'='kuwait-catalog-20261102')<>240 then
    raise exception 'Fixture count mismatch';
  end if;
end;
$verify$;
select jsonb_build_object('fixture','kuwait-catalog-20261102','shops',60,'barbers',180,'services',360,'managerLogins',60,
  'barberLogins',180,'existingRecordsPreserved',true,'adminUnchanged',true,
  'scheduleAnchor',(current_timestamp at time zone 'Asia/Kuwait')::date,
  'cities',(select jsonb_agg(jsonb_build_object('governorate',g.name_en,'city',c.name,'city_ar',c.name_ar) order by c.n)
    from seed_cities c join public.governorates g on g.id=c.governorate_id)) as seed_report;
commit;
