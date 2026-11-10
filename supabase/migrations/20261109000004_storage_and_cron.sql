-- SnapshotZA · 0004 · Storage buckets + scheduled jobs (Supabase-only; not exercised by the local test)
-- Portfolio / proof / delivery images are served by Cloudinary. Supabase Storage holds only:
--   avatars              public   profile photos
--   verification-docs    PRIVATE  SA ID / passport / selfie (POPIA: deleted after review)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('verification-docs', 'verification-docs', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

-- Files are stored under "<auth.uid()>/<filename>", so ownership is the first path segment.
create policy "avatars are public" on storage.objects for select using (bucket_id = 'avatars');
create policy "users manage own avatar" on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner uploads verification docs" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner reads verification docs" on storage.objects for select to authenticated
  using (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner deletes verification docs" on storage.objects for delete to authenticated
  using (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "admins read verification docs" on storage.objects for select to authenticated
  using (bucket_id = 'verification-docs' and public.is_admin());

-- Scheduled payouts: every 15 minutes (Tier 2 24h release, Tier 1 7-day auto-release, stale pending cleanup).
-- Requires the pg_cron extension (Dashboard -> Database -> Extensions).
create extension if not exists pg_cron;
select cron.schedule('process-due-payouts', '*/15 * * * *', $$ select public.process_due_payouts(); $$);
