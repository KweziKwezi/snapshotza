-- SnapshotZA · 0016 · Security hardening (before real payouts)
--
--  1. Least privilege: visitors and signed-in users lose table and function permissions the app never uses
--     (row level security already blocked them; this removes the second line of risk).
--  2. Payment records: only admins can read them (they may hold gateway data).
--  3. Reviews: the public sees the rating and comment, not who wrote it.
--  4. Photos and profile pictures must live in our own storage, in the owner's folder.
--  5. Size limits on everything people type.
--  6. Booking abuse: at most 3 unpaid reservations at once and 10 new reservations an hour per client.
--  7. Admins need two-step sign-in (an authenticator app) before any admin power works.
--  8. Security notices: changing bank details or a phone number tells the account owner.
--  9. POPIA: ID documents are deleted 7 days after review (the daily job now does it; before, nothing did).
-- Safe to run once, after 0015.

---------------------------------------------------------------------------
-- 1. Least privilege
---------------------------------------------------------------------------
-- Visitors read the public catalogue only; they never write anything.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- The public photographer list is read-only for everyone.
revoke insert, update, delete on public.public_photographers from authenticated;
-- Tables people never write to directly (everything goes through checked functions).
revoke insert, update, delete on public.bookings, public.payments, public.payouts, public.disputes, public.reviews,
  public.notifications, public.chat_reads, public.reschedule_requests from authenticated;
grant update (read_at) on public.notifications to authenticated;
-- Chat messages are sent, never edited or deleted by users.
revoke update, delete on public.chat_messages from authenticated;

-- Helper and trigger functions: nobody needs to call these directly.
revoke execute on function
  public.calc_amounts(numeric), public.slot_conflicts(uuid, timestamptz, timestamptz, uuid),
  public.handle_new_user(), public.guard_profile_update(), public.guard_photographer_update(), public.guard_payout_account(),
  public.sync_bank_verified(), public.on_booking_completed(), public.chat_guard(), public.chat_notify(),
  public.bookings_snapshot_package(), public.disputes_set_due(), public.profiles_phone_normalize(), public.sync_auth_email()
from public, anon, authenticated;
-- Visitors only need what the public pages use (and what the public row rules call).
revoke execute on function
  public.can_see_contact(uuid), public.has_booking_with_photographer(uuid), public.is_booking_party(uuid),
  public.my_photographer_id(), public.normalize_sa_phone(text), public.is_end_user()
from public, anon;
grant execute on function
  public.can_see_contact(uuid), public.has_booking_with_photographer(uuid), public.is_booking_party(uuid),
  public.my_photographer_id(), public.normalize_sa_phone(text), public.is_end_user()
to authenticated;

---------------------------------------------------------------------------
-- 2. Payment records: admins only
---------------------------------------------------------------------------
drop policy payments_select on public.payments;
create policy payments_admin on public.payments for select to authenticated using (public.is_admin());

---------------------------------------------------------------------------
-- 3. Reviews: no reviewer identity in public
---------------------------------------------------------------------------
revoke select on public.reviews from anon, authenticated;
grant select (id, photographer_id, rating, comment, created_at) on public.reviews to anon, authenticated;

---------------------------------------------------------------------------
-- 4. Images must be our own storage, in the owner's folder
---------------------------------------------------------------------------
-- https://<project>.supabase.co/storage/v1/object/public/<bucket>/<owner id>/<file>
create function public.is_own_storage_url(p_url text, p_bucket text, p_owner uuid) returns boolean language sql immutable as $$
  select p_url ~ ('^https://[a-z0-9-]+\.supabase\.(co|in)/storage/v1/object/public/' || p_bucket || '/' || p_owner::text || '/[A-Za-z0-9._-]+$');
$$;

create function public.guard_photo_urls() returns trigger language plpgsql as $$
begin
  if public.is_end_user() and not public.is_admin() and (new.is_portfolio or new.is_proof) then
    if not public.is_own_storage_url(new.url, 'portfolio', auth.uid())
       or (new.thumbnail_url is not null and not public.is_own_storage_url(new.thumbnail_url, 'portfolio', auth.uid())) then
      raise exception 'photos must be uploaded through SnapshotZA' using errcode = '42501';
    end if;
    if new.storage_path is not null and new.storage_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') then
      raise exception 'photos must be uploaded through SnapshotZA' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_photo_urls before insert or update on public.photos
  for each row execute function public.guard_photo_urls();

create function public.guard_profile_photo() returns trigger language plpgsql as $$
begin
  if public.is_end_user() and new.profile_photo_url is not null and new.profile_photo_url is distinct from old.profile_photo_url
     and not public.is_own_storage_url(new.profile_photo_url, 'avatars', new.id) then
    raise exception 'profile photos must be uploaded through SnapshotZA' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_profile_photo before update of profile_photo_url on public.profiles
  for each row execute function public.guard_profile_photo();

-- Chat pictures (not offered in the app yet) follow the same rule; links stay text.
create or replace function public.chat_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.message_type = 'system' then return new; end if;
  new.content := trim(coalesce(new.content, ''));
  if new.message_type = 'text' and new.content = '' then raise exception 'write a message first'; end if;
  if char_length(new.content) > 2000 then raise exception 'that message is too long (2000 characters at most)'; end if;
  if new.image_url is not null and not public.is_own_storage_url(new.image_url, 'portfolio', new.sender_id) then
    raise exception 'pictures must be uploaded through SnapshotZA' using errcode = '42501';
  end if;
  if (select count(*) from public.chat_messages
       where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'you are sending messages too fast; please wait a moment';
  end if;
  return new;
end $$;

-- ID document rows must point at the owner's own folder, and the owner cannot postpone their deletion.
create function public.guard_verification_doc() returns trigger language plpgsql as $$
begin
  if public.is_end_user() and not public.is_admin() then
    if new.storage_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') then
      raise exception 'documents must be uploaded through SnapshotZA' using errcode = '42501';
    end if;
    new.delete_after := case when tg_op = 'UPDATE' then old.delete_after else null end;
  end if;
  return new;
end $$;
create trigger guard_verification_doc before insert or update on public.verification_documents
  for each row execute function public.guard_verification_doc();

---------------------------------------------------------------------------
-- 5. Size limits on typed text (NOT VALID: existing rows are left alone, new writes are checked)
---------------------------------------------------------------------------
alter table public.profiles add constraint profiles_name_len check (char_length(full_name) <= 100) not valid;
alter table public.photographer_profiles
  add constraint pp_bio_len check (bio is null or char_length(bio) <= 1000) not valid,
  add constraint pp_location_len check (location is null or char_length(location) <= 120) not valid,
  add constraint pp_specialties_len check (specialties is null or cardinality(specialties) <= 12) not valid,
  add constraint pp_website_url check (website_url is null or (website_url ~ '^https://' and char_length(website_url) <= 200)) not valid,
  add constraint pp_instagram check (instagram_handle is null or instagram_handle ~ '^@?[A-Za-z0-9._]{1,30}$') not valid;
alter table public.packages
  add constraint packages_name_len check (char_length(name) <= 60) not valid,
  add constraint packages_price_range check (price_zar <= 1000000) not valid,
  add constraint packages_photos_range check (num_photos <= 5000) not valid,
  add constraint packages_includes_len check (includes is null or cardinality(includes) <= 20) not valid;
alter table public.payout_accounts add constraint payout_holder_len check (char_length(account_holder) <= 100) not valid;

---------------------------------------------------------------------------
-- 6. Booking abuse limits
---------------------------------------------------------------------------
alter table public.platform_settings
  add column max_unpaid_holds      int not null default 3  check (max_unpaid_holds between 1 and 20),
  add column max_bookings_per_hour int not null default 10 check (max_bookings_per_hour between 1 and 100);

create or replace function public.create_booking(
  p_package_id uuid, p_shoot_date date, p_shoot_time time, p_location text, p_gateway public.pay_gateway, p_rate text
) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role; pk public.packages; pp public.photographer_profiles;
  amt record; s public.platform_settings; v_start timestamptz; b public.bookings; v_flex numeric;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'client' then raise exception 'only clients can make bookings'; end if;
  if p_rate is null or p_rate not in ('saver', 'flexible') then raise exception 'choose the Saver or the Flexible rate'; end if;
  if (select phone from public.profiles where id = auth.uid()) is null then
    raise exception 'add your phone number to your account before booking'; end if;
  -- Unpaid reservations hold a photographer's time, so one person may only hold a few at once, and only make so
  -- many in an hour. This stops anyone blocking a photographer's calendar with reservations they never pay for.
  if (select count(*) from public.bookings bk, public.platform_settings s0
       where bk.client_id = auth.uid() and bk.status = 'pending'
         and bk.created_at > now() - make_interval(mins => s0.pending_hold_minutes)) >= (select max_unpaid_holds from public.platform_settings) then
    raise exception 'you already have % unpaid reservations; pay for or cancel one first', (select max_unpaid_holds from public.platform_settings);
  end if;
  if (select count(*) from public.bookings bk where bk.client_id = auth.uid() and bk.created_at > now() - interval '1 hour')
     >= (select max_bookings_per_hour from public.platform_settings) then
    raise exception 'too many reservations in a short time; please try again later';
  end if;

  select * into pk from public.packages where id = p_package_id and is_active;
  if not found then raise exception 'package not available'; end if;
  select * into pp from public.photographer_profiles where id = pk.photographer_id;
  if pp.verification_status <> 'approved' then raise exception 'photographer is not accepting bookings'; end if;
  select * into s from public.platform_settings;

  perform pg_advisory_xact_lock(hashtext(pp.id::text));   -- serialise bookings per photographer
  v_start := public.assert_slot_free(pp.id, p_shoot_date, p_shoot_time, pk.duration_hours);

  v_flex := case when p_rate = 'flexible' then s.flexible_fee else 0 end;
  select * into amt from public.calc_amounts(pk.price_zar);
  insert into public.bookings (
    client_id, photographer_id, package_id, shoot_date, shoot_time, shoot_starts_at, shoot_ends_at, shoot_location,
    total_amount, package_price, flex_fee, net_amount, rate_type, rate_accepted_at,
    platform_fee, transaction_fee, deposit_amount, tier_at_booking, gateway
  ) values (
    auth.uid(), pp.id, pk.id, p_shoot_date, p_shoot_time, v_start, v_start + make_interval(hours => pk.duration_hours), coalesce(p_location, ''),
    pk.price_zar + v_flex, pk.price_zar, v_flex, amt.net, p_rate, now(),
    amt.platform_fee, amt.transaction_fee,
    round(amt.net * case pp.tier when 3 then s.tier3_deposit_share when 2 then s.tier2_deposit_share
                                 else s.tier1_deposit_share end, 2),
    pp.tier, p_gateway
  ) returning * into b;
  return b;
end $$;
revoke all on function public.create_booking(uuid, date, time, text, public.pay_gateway, text) from public, anon;
grant execute on function public.create_booking(uuid, date, time, text, public.pay_gateway, text) to authenticated;

---------------------------------------------------------------------------
-- 7. Admins need two-step sign-in
---------------------------------------------------------------------------
-- An admin account only has admin powers in a session verified with an authenticator app (aal2). A stolen admin
-- password on its own can therefore not approve photographers, verify bank details, decide disputes or mark money sent.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

drop function public.worker_photo_key(uuid, uuid, text);
create function public.worker_photo_key(p_user uuid, p_photo uuid, p_variant text, p_aal text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.photos; b public.bookings; v_pu uuid; v_admin boolean;
begin
  if p_variant not in ('preview', 'full') then raise exception 'unknown variant'; end if;
  select * into r from public.photos where id = p_photo and booking_id is not null and not is_proof;
  if not found or r.storage_path is null then raise exception 'photo not found'; end if;
  select * into b from public.bookings where id = r.booking_id;
  if b.gallery_purged_at is not null then raise exception 'these photos were deleted after the download period'; end if;
  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  -- Admins only count as admins with two-step sign-in (the Worker passes the session's assurance level).
  select exists (select 1 from public.profiles where id = p_user and role = 'admin') and coalesce(p_aal, '') = 'aal2' into v_admin;

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
revoke all on function public.worker_photo_key(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.worker_photo_key(uuid, uuid, text, text) to service_role;

---------------------------------------------------------------------------
-- 8. Security notices
---------------------------------------------------------------------------
create function public.notify_security_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  if tg_table_name = 'payout_accounts' then
    if (new.bank_name, new.account_number, new.account_holder) is distinct from (old.bank_name, old.account_number, old.account_holder) then
      select user_id into v_user from public.photographer_profiles where id = new.photographer_id;
      perform public.notify(v_user, 'security', 'Your bank details were changed',
        format('Payments will now go to %s, account ending %s. Withdrawals are paused until our team checks the new details. If you did not make this change, contact us immediately.',
               new.bank_name, right(new.account_number, 4)));
      perform public.notify_admins('security', 'Bank details changed', 'A photographer changed their bank details. Check them under Bank checks before any withdrawal.');
    end if;
  elsif tg_table_name = 'profiles' then
    if old.phone is not null and new.phone is distinct from old.phone then
      perform public.notify(new.id, 'security', 'Your phone number was changed',
        format('Your number is now %s. If you did not make this change, contact us immediately.', '0' || substr(new.phone, 4)));
    end if;
  end if;
  return null;
end $$;
create trigger payout_accounts_security after update on public.payout_accounts
  for each row execute function public.notify_security_change();
create trigger profiles_security after update of phone on public.profiles
  for each row execute function public.notify_security_change();

---------------------------------------------------------------------------
-- 9. POPIA: delete ID documents 7 days after review (the Worker's daily job calls these)
---------------------------------------------------------------------------
create function public.list_expired_documents() returns table (id uuid, storage_path text)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.storage_path from public.verification_documents d
   where d.delete_after is not null and d.delete_after <= now()
   order by d.delete_after limit 500;
$$;
create function public.mark_documents_deleted(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from public.verification_documents where id = any(p_ids) and delete_after is not null and delete_after <= now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function
  public.list_expired_documents(), public.mark_documents_deleted(uuid[]), public.notify_security_change(),
  public.guard_photo_urls(), public.guard_profile_photo(), public.guard_verification_doc()
from public, anon, authenticated;
grant execute on function public.list_expired_documents(), public.mark_documents_deleted(uuid[]) to service_role;
grant execute on function public.is_own_storage_url(text, text, uuid) to authenticated;
