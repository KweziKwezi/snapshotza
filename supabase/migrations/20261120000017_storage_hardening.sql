-- SnapshotZA · 0017 · Storage hardening (Supabase only: not part of the local test run)
--
-- Public buckets serve files by their public link without any read rule. The broad "anyone can read" rules on the
-- portfolio and avatars buckets also let anyone LIST every file (and so every user's id). They are removed; owners
-- keep full access to their own folder, and public links keep working.
-- Safe to run once, after 0016.
drop policy if exists "portfolio photos are public" on storage.objects;
drop policy if exists "avatars are public" on storage.objects;

-- Belt and braces on file types and sizes (also set when the buckets were created).
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id in ('portfolio', 'avatars');
update storage.buckets set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
 where id = 'verification-docs';
