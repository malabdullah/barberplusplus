-- Deterministic local/CI fixtures. These values are synthetic and must never be
-- applied to staging or production.

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'admin@barber.test',
    extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')),
    '2030-01-01 08:00:00+00',
    '{"provider":"email","providers":["email"],"role":"admin"}',
    '{"name":"Synthetic Admin"}',
    '2030-01-01 08:00:00+00',
    '2030-01-01 08:00:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'manager@barber.test',
    extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')),
    '2030-01-01 08:00:00+00',
    '{"provider":"email","providers":["email"],"role":"manager"}',
    '{"name":"Synthetic Manager"}',
    '2030-01-01 08:00:00+00',
    '2030-01-01 08:00:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'agent@barber.test',
    extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')),
    '2030-01-01 08:00:00+00',
    '{"provider":"email","providers":["email"],"role":"agent"}',
    '{"name":"Synthetic Agent"}',
    '2030-01-01 08:00:00+00',
    '2030-01-01 08:00:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'barber@barber.test',
    extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')),
    '2030-01-01 08:00:00+00',
    '{"provider":"email","providers":["email"],"role":"barber"}',
    '{"name":"Synthetic Barber"}',
    '2030-01-01 08:00:00+00',
    '2030-01-01 08:00:00+00'
  );

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  ('10000000-0000-4000-8000-' || right(id::text, 12))::uuid,
  email,
  id,
  jsonb_build_object(
    'sub', id::text,
    'email', email,
    'email_verified', true
  ),
  'email',
  '2030-01-01 08:00:00+00',
  '2030-01-01 08:00:00+00',
  '2030-01-01 08:00:00+00'
from auth.users
where email like '%@barber.test';

insert into public.governorates (id, name_en, name_ar, code)
values (9001, 'Synthetic Governorate', 'محافظة تجريبية', 'TEST');

insert into public.areas (id, governorate_id, name_en, name_ar)
values (9001, 9001, 'Synthetic Area', 'منطقة تجريبية');

insert into public.branches (
  id,
  manager_id,
  name,
  name_ar,
  address,
  city,
  country,
  phone,
  email,
  governorate_id,
  area_id,
  number_of_barbers
)
values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'Synthetic Branch',
  'فرع تجريبي',
  'Synthetic address',
  'Kuwait City',
  'Kuwait',
  '50000001',
  'branch@barber.test',
  9001,
  9001,
  1
);

insert into public.services (
  id,
  branch_id,
  name,
  name_ar,
  description,
  duration,
  price
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Synthetic Haircut',
  'حلاقة تجريبية',
  'Local and CI fixture',
  30,
  10.000
);

insert into public.barbers (
  id,
  user_id,
  branch_id,
  name,
  name_ar,
  email,
  phone,
  service_ids,
  invite_status,
  invite_accepted_at
)
values (
  '30000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  'Synthetic Barber',
  'حلاق تجريبي',
  'barber@barber.test',
  '50000002',
  array['20000000-0000-4000-8000-000000000001'::uuid],
  'accepted',
  '2030-01-01 08:00:00+00'
);

insert into public.customers (
  id,
  name,
  name_ar,
  phone,
  email,
  preferred_barber_id,
  preferred_branch_id,
  created_by_type,
  created_by_user_id
)
values (
  '40000000-0000-4000-8000-000000000001',
  'Synthetic Customer',
  'عميل تجريبي',
  '50000003',
  'customer@barber.test',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'manager',
  '00000000-0000-4000-8000-000000000002'
);

insert into public.bookings (
  id,
  branch_id,
  barber_id,
  service_ids,
  date,
  time,
  duration,
  price,
  status,
  added_by_type,
  added_by_user_id,
  customer_id
)
values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  array['20000000-0000-4000-8000-000000000001'::uuid],
  '2030-01-02',
  '10:00:00',
  30,
  10.000,
  'confirmed',
  'manager',
  '00000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001'
);

insert into public.booking_reminders (
  id,
  booking_id,
  reminder_type,
  scheduled_at
)
values (
  '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '1_hour',
  '2030-01-02 06:00:00+00'
);

insert into public.notifications (
  id,
  recipient_user_id,
  recipient_branch_id,
  recipient_role,
  type,
  title,
  message,
  entity_type,
  entity_id
)
values (
  '70000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'manager',
  'booking_created',
  'Synthetic booking',
  'A deterministic booking fixture was created.',
  'booking',
  '50000000-0000-4000-8000-000000000001'
);

insert into public.notification_templates (
  id,
  template_key,
  title_en,
  title_ar,
  message_en,
  message_ar
)
values (
  '71000000-0000-4000-8000-000000000001',
  'synthetic_booking_created',
  'Synthetic booking',
  'حجز تجريبي',
  'A deterministic booking fixture was created.',
  'تم إنشاء حجز تجريبي.'
);

insert into public.user_settings (id, user_id, theme, language)
values (
  '72000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'dark',
  'en'
);

insert into public.user_notification_preferences (id, user_id)
values (
  '73000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002'
);

insert into public.admin_settings (
  id,
  setting_key,
  setting_value,
  description,
  category,
  updated_by
)
values (
  '74000000-0000-4000-8000-000000000001',
  'synthetic_fixture',
  '{"enabled":true}',
  'Local and CI fixture',
  'features',
  '00000000-0000-4000-8000-000000000001'
);

insert into public.audit_logs (
  id,
  admin_user_id,
  action_type,
  target_entity_type,
  target_entity_id,
  metadata
)
values (
  '75000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'booking_modified',
  'booking',
  '50000000-0000-4000-8000-000000000001',
  '{"fixture":true}'
);

insert into public.logs (
  id,
  level,
  log_type,
  user_id,
  user_role,
  branch_id,
  barber_id,
  entity_type,
  entity_id,
  action,
  message,
  metadata
)
values (
  '76000000-0000-4000-8000-000000000001',
  'info',
  'action',
  '00000000-0000-4000-8000-000000000002',
  'manager',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'booking',
  '50000000-0000-4000-8000-000000000001',
  'create',
  'Synthetic fixture created',
  '{"fixture":true}'
);

insert into public.rate_limits (
  phone_number,
  minute_count,
  minute_window_start,
  hour_count,
  hour_window_start
)
values ('50000003', 1, 1893456000, 1, 1893456000);

insert into public.suspicious_activities (
  id,
  user_id,
  activity_type,
  severity,
  description,
  metadata
)
values (
  '77000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  'synthetic_test',
  'low',
  'Deterministic local security fixture',
  '{"fixture":true}'
);

insert into public.whatsapp_conversations (
  id,
  phone_number,
  customer_name,
  current_state,
  context,
  language,
  current_session_id
)
values (
  '80000000-0000-4000-8000-000000000001',
  '50000003',
  'Synthetic Customer',
  'booking_confirmed',
  '{"fixture":true}',
  'en',
  '80000000-0000-4000-8000-000000000002'
);

insert into public.whatsapp_messages (
  id,
  conversation_id,
  whatsapp_message_id,
  direction,
  content,
  status,
  session_id
)
values (
  '81000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  'synthetic-message-1',
  'inbound',
  'Synthetic booking request',
  'read',
  '80000000-0000-4000-8000-000000000002'
);

insert into public.whatsapp_logs (
  id,
  conversation_id,
  phone_number,
  log_level,
  event_type,
  message,
  metadata
)
values (
  '82000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '50000003',
  'info',
  'synthetic_fixture',
  'Synthetic conversation fixture created',
  '{"fixture":true}'
);
