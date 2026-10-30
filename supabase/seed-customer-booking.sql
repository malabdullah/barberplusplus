-- Synthetic fixtures for the local public booking journey. Never apply to live.
insert into public.branches (id, manager_id, name, name_ar, city, country, address, image_url, number_of_barbers)
values
('10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','City Centre branch','فرع وسط المدينة','Kuwait City','Kuwait','Central district','/booking-demo/city-centre.png',2),
('10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002','Seafront branch','فرع الواجهة البحرية','Kuwait City','Kuwait','Waterfront district','/booking-demo/seafront.png',2),
('10000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000002','Market Street branch','فرع شارع السوق','Kuwait City','Kuwait','Market district','/booking-demo/market-street.png',2),
('10000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000002','Seafront Salmiya branch','فرع الواجهة البحرية بالسالمية','Salmiya','Kuwait','Salmiya district','/booking-demo/seafront.png',2)
on conflict (id) do nothing;

insert into public.services (id, branch_id, name, name_ar, duration, price)
select ('20000000-0000-4000-8000-' || lpad((n * 10 + s)::text, 12, '0'))::uuid,
  ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case s when 1 then 'Haircut' when 2 then 'Beard trim' else 'Haircut & beard' end,
  case s when 1 then 'قص الشعر' when 2 then 'تهذيب اللحية' else 'قص الشعر وتهذيب اللحية' end,
  case s when 1 then 30 when 2 then 15 else 45 end,
  case s when 1 then 5 when 2 then 3 else 7 end
from generate_series(11,14) n cross join generate_series(1,3) s
on conflict (id) do nothing;

insert into public.barbers (id, branch_id, name, name_ar, service_ids, availability, max_booking_days)
select ('30000000-0000-4000-8000-' || lpad((n * 10 + b)::text, 12, '0'))::uuid,
  ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case b when 1 then 'Omar' else 'Ali' end,
  case b when 1 then 'عمر' else 'علي' end,
  array[('20000000-0000-4000-8000-' || lpad((n * 10 + 1)::text, 12, '0'))::uuid,
    ('20000000-0000-4000-8000-' || lpad((n * 10 + case b when 1 then 2 else 3 end)::text, 12, '0'))::uuid],
  (select jsonb_object_agg(day, jsonb_build_object('enabled',true,'start','09:00','end','21:00'))
   from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day),
  30
from generate_series(11,14) n cross join generate_series(1,2) b
on conflict (id) do nothing;
