-- SnapshotZA · 0010 · Delivering the real photos (stored in Cloudflare R2, handled by the Worker)
--
-- The Worker (src/worker.js) is the only thing that stores or serves delivery files. It calls the three
-- functions below with the service-role key; nobody else can call them, so a photographer cannot
-- "deliver" photos that were never uploaded.
--
-- Safe to run once, after 0009.

alter table public.photos
  add column preview_path text,       -- smaller copy the client can look at before paying out the rest
  add column file_name    text,
  add column size_bytes   bigint;

---------------------------------------------------------------------------
-- Photographers can no longer add delivery photos straight into the table.
-- (Portfolio photos and proofs still work as before.)
---------------------------------------------------------------------------
drop policy photos_owner_write on public.photos;
create policy photos_owner_write on public.photos for insert to authenticated
  with check (photographer_id = public.my_photographer_id()
              and (booking_id is null
                   or (is_proof and exists (select 1 from public.bookings b
                                             where b.id = booking_id and b.photographer_id = public.my_photographer_id()))));
drop policy photos_owner_update on public.photos;
create policy photos_owner_update on public.photos for update to authenticated
  using (photographer_id = public.my_photographer_id() and booking_id is null)
  with check (photographer_id = public.my_photographer_id() and booking_id is null);
drop policy photos_owner_delete on public.photos;
create policy photos_owner_delete on public.photos for delete to authenticated
  using (photographer_id = public.my_photographer_id() and (booking_id is null or is_proof));

---------------------------------------------------------------------------
-- Worker functions (service role only)
---------------------------------------------------------------------------
-- A photographer adds one edited photo to a booking they are about to deliver.
create function public.worker_register_photo(p_user uuid, p_booking uuid, p_photo uuid, p_name text, p_size bigint)
returns public.photos
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_pu uuid; v_need int; v_have int; r public.photos;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'booking not found'; end if;
  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  if v_pu is distinct from p_user then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status not in ('confirmed', 'in_progress') then raise exception 'photos can only be added before they are delivered'; end if;
  if now() < b.shoot_starts_at then raise exception 'the shoot has not happened yet'; end if;
  if p_size is null or p_size < 1 or p_size > 52428800 then raise exception 'each photo must be under 50 MB'; end if;
  select num_photos into v_need from public.packages where id = b.package_id;
  select count(*) into v_have from public.photos where booking_id = b.id and not is_proof;
  if v_have >= v_need + 20 then raise exception 'this package includes % photos; you have already uploaded %', v_need, v_have; end if;

  insert into public.photos (id, photographer_id, booking_id, url, storage_path, preview_path, file_name, size_bytes, is_proof, upload_order)
  values (p_photo, b.photographer_id, b.id,
          format('r2:deliveries/%s/%s.full', b.id, p_photo),
          format('deliveries/%s/%s.full', b.id, p_photo),
          format('deliveries/%s/%s.preview', b.id, p_photo),
          left(coalesce(nullif(trim(p_name), ''), 'photo'), 200), p_size, false, v_have + 1)
  returning * into r;
  return r;
end $$;

-- A photographer removes one of their not-yet-delivered photos. Returns the row so the Worker can delete the files.
create function public.worker_remove_photo(p_user uuid, p_photo uuid) returns public.photos
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.photos; b public.bookings; v_pu uuid;
begin
  select * into r from public.photos where id = p_photo and booking_id is not null and not is_proof for update;
  if not found then raise exception 'photo not found'; end if;
  select * into b from public.bookings where id = r.booking_id for update;
  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  if v_pu is distinct from p_user then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status not in ('confirmed', 'in_progress') then raise exception 'photos can only be removed before they are delivered'; end if;
  delete from public.photos where id = r.id;
  return r;
end $$;

-- Which file may this person fetch? Returns the storage key, or refuses.
--   photographer of the booking and admins: full + preview (until the gallery is deleted)
--   client: preview once delivered; full-size only after the payment is released, inside the download window
create function public.worker_photo_key(p_user uuid, p_photo uuid, p_variant text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.photos; b public.bookings; v_pu uuid; v_admin boolean;
begin
  if p_variant not in ('preview', 'full') then raise exception 'unknown variant'; end if;
  select * into r from public.photos where id = p_photo and booking_id is not null and not is_proof;
  if not found or r.storage_path is null then raise exception 'photo not found'; end if;
  select * into b from public.bookings where id = r.booking_id;
  if b.gallery_purged_at is not null then raise exception 'these photos were deleted after the download period'; end if;
  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  select exists (select 1 from public.profiles where id = p_user and role = 'admin') into v_admin;

  if v_pu = p_user or v_admin then
    null;                                                                             -- allowed
  elsif b.client_id = p_user then
    if b.gallery_uploaded_at is null or b.status not in ('gallery_uploaded', 'completed', 'disputed') then
      raise exception 'not allowed' using errcode = '42501'; end if;
    if b.gallery_expires_at is not null and now() >= b.gallery_expires_at then
      raise exception 'the download period has ended'; end if;
    if p_variant = 'full' and not public.can_download_gallery(b.id, p_user) then
      raise exception 'full-size photos unlock when you approve the gallery'; end if;
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return case p_variant when 'full' then r.storage_path else r.preview_path end;
end $$;

revoke all on function
  public.worker_register_photo(uuid, uuid, uuid, text, bigint),
  public.worker_remove_photo(uuid, uuid),
  public.worker_photo_key(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.worker_register_photo(uuid, uuid, uuid, text, bigint),
  public.worker_remove_photo(uuid, uuid),
  public.worker_photo_key(uuid, uuid, text)
to service_role;

---------------------------------------------------------------------------
-- Approving the photos also confirms the shoot happened. Without this, a client who approves before the
-- 24-hour confirmation window ends would see nothing happen until the window closes.
---------------------------------------------------------------------------
create or replace function public.approve_gallery(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.client_id is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status <> 'gallery_uploaded' then raise exception 'no gallery awaiting approval'; end if;
  update public.bookings
     set gallery_approved_at = now(), shoot_confirmed_at = coalesce(shoot_confirmed_at, now())
   where id = b.id;
  perform public.post_system_message(b.id, 'Gallery approved.');
  perform public.process_booking_payouts(b.id);
  select * into b from public.bookings where id = p_booking;
  return b;
end $$;
