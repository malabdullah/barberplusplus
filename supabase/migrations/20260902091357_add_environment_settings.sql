create table if not exists public.environment_settings (
  id text primary key default 'current' check (id = 'current'),
  environment text not null check (environment in ('development', 'production')),
  banner_text text not null check (char_length(banner_text) between 1 and 160),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.environment_settings is
  'Non-sensitive environment identity displayed by the frontend.';

alter table public.environment_settings enable row level security;

revoke all on table public.environment_settings from anon, authenticated;
grant select on table public.environment_settings to anon, authenticated;

create policy "Public can read the enabled environment banner"
on public.environment_settings
for select
to anon, authenticated
using (enabled = true);
