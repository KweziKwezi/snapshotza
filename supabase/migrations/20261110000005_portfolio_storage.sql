-- SnapshotZA · 0005 · Storage for photographer onboarding.  Safe to run more than once.
--   portfolio          PUBLIC   portfolio photos shown to clients (resized in the browser before upload)
--   verification-docs  PRIVATE  SA ID / passport / selfie (re-declared here so this migration is self-contained)
-- Files live under "<auth.uid()>/<file>", so ownership is the first path segment.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('portfolio', 'portfolio', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('verification-docs', 'verification-docs', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  -- portfolio
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'portfolio photos are public') then
    create policy "portfolio photos are public" on storage.objects for select
      using (bucket_id = 'portfolio');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'owner manages own portfolio files') then
    create policy "owner manages own portfolio files" on storage.objects for all to authenticated
      using (bucket_id = 'portfolio' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'portfolio' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  -- avatars (also created in migration 4; re-checked here)
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars are public') then
    create policy "avatars are public" on storage.objects for select using (bucket_id = 'avatars');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'users manage own avatar') then
    create policy "users manage own avatar" on storage.objects for all to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  -- verification documents: the owner can add / see / remove; admins can see. Nobody else, ever.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'owner uploads verification docs') then
    create policy "owner uploads verification docs" on storage.objects for insert to authenticated
      with check (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'owner reads verification docs') then
    create policy "owner reads verification docs" on storage.objects for select to authenticated
      using (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'owner deletes verification docs') then
    create policy "owner deletes verification docs" on storage.objects for delete to authenticated
      using (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'admins read verification docs') then
    create policy "admins read verification docs" on storage.objects for select to authenticated
      using (bucket_id = 'verification-docs' and public.is_admin());
  end if;
end $$;
