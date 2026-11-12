-- SnapshotZA · 0011 · A booking remembers how many photos it was sold with
--
-- Photographers can now edit their packages at any time. Without this, editing a package would silently change
-- what an existing client had paid for. Safe to run once, after 0010.

alter table public.bookings add column num_photos int check (num_photos > 0);
update public.bookings b set num_photos = p.num_photos from public.packages p where p.id = b.package_id and b.num_photos is null;

create function public.bookings_snapshot_package() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.num_photos is null then
    select num_photos into new.num_photos from public.packages where id = new.package_id;
  end if;
  return new;
end $$;
create trigger bookings_snapshot_package before insert on public.bookings
  for each row execute function public.bookings_snapshot_package();

-- How many edited photos must be uploaded before this booking can be delivered?
--   real bookings: exactly what the client was sold
--   TEST bookings (test mode on): the lower of that and the package's CURRENT count, so a photographer can shrink a
--   package to a handful of photos and test delivery without uploading hundreds.
create function public.delivery_required(p_booking uuid) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_now int;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or not (public.is_booking_party(p_booking) or public.is_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then return null; end if;
  select num_photos into v_now from public.packages where id = b.package_id;
  if b.simulated and coalesce((select simulate_payments from public.platform_settings), false) then
    return least(coalesce(b.num_photos, v_now), coalesce(v_now, b.num_photos));
  end if;
  return coalesce(b.num_photos, v_now);
end $$;
revoke all on function public.delivery_required(uuid) from public, anon;
grant execute on function public.delivery_required(uuid) to authenticated, service_role;

create or replace function public.deliver_gallery(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_need int; v_have int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.photographer_id is distinct from public.my_photographer_id() then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status not in ('confirmed', 'in_progress') then raise exception 'booking is not in a deliverable state (%)', b.status; end if;
  if now() < b.shoot_starts_at then raise exception 'the shoot has not happened yet'; end if;
  -- Delivery is verified: all of the promised edited photos must be on the platform (previews/proofs don't count).
  v_need := public.delivery_required(b.id);
  select count(*) into v_have from public.photos where booking_id = b.id and not is_proof;
  if v_have < v_need then raise exception 'upload all % edited photos before delivering (you have %)', v_need, v_have; end if;

  update public.bookings
     set status = 'gallery_uploaded', gallery_uploaded_at = now(),
         gallery_expires_at = now() + make_interval(days => (select gallery_retention_days from public.platform_settings))
   where id = b.id returning * into b;
  perform public.post_system_message(b.id, format('Your photos are ready. Download them within %s days; after that they are deleted. Ask your photographer for a Google Drive link if you want to keep them longer.',
                                                  (select gallery_retention_days from public.platform_settings)));
  perform public.process_booking_payouts(b.id);
  select * into b from public.bookings where id = p_booking;
  return b;
end $$;

create or replace function public.worker_register_photo(p_user uuid, p_booking uuid, p_photo uuid, p_name text, p_size bigint)
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
  v_need := public.delivery_required(b.id);
  select count(*) into v_have from public.photos where booking_id = b.id and not is_proof;
  if v_have >= v_need + 20 then raise exception 'this booking includes % photos; you have already uploaded %', v_need, v_have; end if;

  insert into public.photos (id, photographer_id, booking_id, url, storage_path, preview_path, file_name, size_bytes, is_proof, upload_order)
  values (p_photo, b.photographer_id, b.id,
          format('r2:deliveries/%s/%s.full', b.id, p_photo),
          format('deliveries/%s/%s.full', b.id, p_photo),
          format('deliveries/%s/%s.preview', b.id, p_photo),
          left(coalesce(nullif(trim(p_name), ''), 'photo'), 200), p_size, false, v_have + 1)
  returning * into r;
  return r;
end $$;
