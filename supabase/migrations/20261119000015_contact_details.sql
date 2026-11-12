-- SnapshotZA · 0015 · Phone numbers and contact details
--
-- * Everyone gives a South African phone number at sign-up. It is stored in one format: +27 followed by 9 digits.
-- * People can change their phone number themselves. Their email can only change through Supabase's confirmation
--   link (so nobody can take over an account by typing someone else's address); the profile follows automatically.
-- * A client needs a phone number on their account to book (the photographer must be able to reach them).
-- Safe to run once, after 0014.

-- "082 123 4567", "+27 82 123 4567", "27821234567", "0821234567" -> "+27821234567". Anything else -> null.
create function public.normalize_sa_phone(p text) returns text language sql immutable as $$
  select case
    when d ~ '^0[1-8][0-9]{8}$' then '+27' || substr(d, 2)
    when d ~ '^27[1-8][0-9]{8}$' then '+' || d
    else null end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- Existing numbers in any of the accepted formats are tidied; new ones must be valid.
update public.profiles set phone = public.normalize_sa_phone(phone) where phone is not null and public.normalize_sa_phone(phone) is not null;
alter table public.profiles add constraint profiles_phone_format check (phone is null or phone ~ '^\+27[1-8][0-9]{8}$') not valid;

-- People may type their number however they like; it is saved in the standard format, or refused.
create function public.profiles_phone_normalize() returns trigger language plpgsql as $$
begin
  if new.phone is not null and (tg_op = 'INSERT' or new.phone is distinct from old.phone) then
    if trim(new.phone) = '' then
      if tg_op = 'UPDATE' and old.phone is not null then
        raise exception 'your phone number cannot be removed, only changed';
      end if;
      new.phone := null;
    else
      new.phone := coalesce(public.normalize_sa_phone(new.phone), new.phone);   -- an invalid number then fails the check
    end if;
  end if;
  return new;
end $$;
create trigger profiles_phone_normalize before insert or update of phone on public.profiles
  for each row execute function public.profiles_phone_normalize();

-- A phone number cannot be removed once given (clients and photographers rely on it).
create or replace function public.guard_profile_update() returns trigger language plpgsql as $$
begin
  if public.is_end_user() and not public.is_admin() then
    if new.role is distinct from old.role or new.id is distinct from old.id then
      raise exception 'role cannot be changed' using errcode = '42501';
    end if;
    if new.email is distinct from old.email then
      raise exception 'change your email from your account settings (we send a confirmation link)' using errcode = '42501';
    end if;
    if old.phone is not null and new.phone is null then
      raise exception 'your phone number cannot be removed, only changed';
    end if;
  end if;
  return new;
end $$;

-- New accounts take the phone number given at sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role public.user_role := 'client';
begin
  if new.raw_user_meta_data ->> 'role' = 'photographer' then v_role := 'photographer'; end if;
  insert into public.profiles (id, role, email, phone, full_name)
  values (new.id, v_role, new.email,
          public.normalize_sa_phone(coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), new.phone)),
          coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  if v_role = 'photographer' then
    insert into public.photographer_profiles (user_id) values (new.id);
  end if;
  return new;
end $$;

-- When someone confirms a new email address, their profile follows.
create function public.sync_auth_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_auth_email();

---------------------------------------------------------------------------
-- Booking needs a phone number
---------------------------------------------------------------------------
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
