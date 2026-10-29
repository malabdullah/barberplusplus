-- The app already limits avatars to these image formats and five megabytes.
-- Enforce limits at the Storage API bucket boundary. Storage tests INSERT
-- permission before object metadata exists, so metadata-dependent RLS would
-- reject valid uploads. Existing objects are not rewritten or removed.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
  array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create function public.can_write_avatar_object(object_name text)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select (select auth.uid()) is not null
    and object_name ~ '^(branches|barbers)/[0-9a-f-]{36}-[0-9]+\.(jpg|jpeg|png|webp|gif)$'
    and (
      (select auth.jwt()->'app_metadata'->>'role') = 'admin'
      or (
        (select auth.jwt()->'app_metadata'->>'role') = 'manager'
        and (
          (split_part(object_name,'/',1) = 'branches' and exists (
            select 1 from public.branches b
            where b.id::text = left(split_part(object_name,'/',2),36)
              and b.manager_id = (select auth.uid())
          ))
          or (split_part(object_name,'/',1) = 'barbers' and exists (
            select 1 from public.barbers b join public.branches branch on branch.id=b.branch_id
            where b.id::text = left(split_part(object_name,'/',2),36)
              and branch.manager_id = (select auth.uid())
          ))
        )
      )
      or (
        (select auth.jwt()->'app_metadata'->>'role') = 'barber'
        and split_part(object_name,'/',1) = 'barbers'
        and exists (
          select 1 from public.barbers b
          where b.id::text = left(split_part(object_name,'/',2),36)
            and b.user_id = (select auth.uid())
        )
      )
    );
$$;
revoke all on function public.can_write_avatar_object(text) from public, anon;
grant execute on function public.can_write_avatar_object(text) to authenticated, service_role;

create policy "Barber avatars read owned metadata" on storage.objects
for select to authenticated
using (bucket_id='avatars' and public.can_write_avatar_object(name));

create policy "Barber avatars upload owned images" on storage.objects
for insert to authenticated
with check (bucket_id='avatars' and public.can_write_avatar_object(name));

create policy "Barber avatars replace owned images" on storage.objects
for update to authenticated
using (bucket_id='avatars' and public.can_write_avatar_object(name))
with check (bucket_id='avatars' and public.can_write_avatar_object(name));

create policy "Barber avatars delete owned images" on storage.objects
for delete to authenticated
using (bucket_id='avatars' and public.can_write_avatar_object(name));
