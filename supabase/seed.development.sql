-- Development only. Never run this seed against production.
insert into public.environment_settings (
  id,
  environment,
  banner_text,
  enabled,
  updated_at
)
values (
  'current',
  'development',
  'Development environment — test data only',
  true,
  now()
)
on conflict (id) do update
set
  environment = excluded.environment,
  banner_text = excluded.banner_text,
  enabled = excluded.enabled,
  updated_at = excluded.updated_at;
