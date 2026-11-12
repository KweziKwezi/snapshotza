-- SnapshotZA · 0008 · Working hours, a gap between shoots, and TEST MODE (simulated payments & withdrawals)
--
-- 1. Photographers set the hours they work (usual hours + optional per-day override). Clients can only book inside them.
-- 2. Several shoots can happen on one day, always with a gap (default 60 min) before and after each one.
-- 3. TEST MODE (platform_settings.simulate_payments, ON by default for now) lets people try the whole money flow without a
--    payment gateway. Everything it touches is flagged `simulated`, and it can only act on bookings that were paid with a
--    simulated payment, so it can never move real money. Switch it off before launch:
--        update public.platform_settings set simulate_payments = false;

---------------------------------------------------------------------------
-- Columns
---------------------------------------------------------------------------
alter table public.platform_settings
  add column simulate_payments     boolean not null default true,
  add column booking_buffer_minutes int     not null default 60 check (booking_buffer_minutes between 0 and 480),
  add column slot_step_minutes      int     not null default 30 check (slot_step_minutes in (15, 30, 60));

alter table public.photographer_profiles
  add column work_start time not null default '08:00',
  add column work_end   time not null default '18:00',
  add constraint photographer_hours_valid check (work_end > work_start);

-- Per-day override of the usual hours (both null = use the usual hours).
alter table public.availability
  add column start_time time,
  add column end_time   time,
  add constraint availability_hours_valid
    check ((start_time is null) = (end_time is null) and (start_time is null or end_time > start_time));

alter table public.bookings add column simulated boolean not null default false;
alter table public.payouts  add column requested_at timestamptz,
                            add column simulated boolean not null default false;

-- A payout is "simulated" when its booking was paid with a simulated payment.
create function public.payout_inherit_simulated() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select simulated into new.simulated from public.bookings where id = new.booking_id;
  return new;
end $$;
create trigger payout_inherit_simulated before insert on public.payouts
  for each row execute function public.payout_inherit_simulated();

---------------------------------------------------------------------------
-- Hours & the gap between shoots
---------------------------------------------------------------------------
-- The hours a photographer works on a day, or NULLs if the day is not open.
create function public.day_window(p_photographer uuid, p_day date, out start_t time, out end_t time)
returns record language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(a.start_time, pp.work_start), coalesce(a.end_time, pp.work_end)
    from public.availability a
    join public.photographer_profiles pp on pp.id = a.photographer_id
   where a.photographer_id = p_photographer and a.day = p_day and a.is_open;
$$;

-- Two shoots must be at least `booking_buffer_minutes` apart (the new one is widened by the gap on both sides).
create or replace function public.slot_conflicts(p_photographer uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.bookings b cross join public.platform_settings s
    where b.photographer_id = p_photographer
      and b.id is distinct from p_exclude
      and tstzrange(b.shoot_starts_at, b.shoot_ends_at)
          && tstzrange(p_start - make_interval(mins => s.booking_buffer_minutes), p_end + make_interval(mins => s.booking_buffer_minutes))
      and (b.status in ('confirmed', 'in_progress', 'gallery_uploaded', 'disputed')
           or (b.status = 'pending' and b.created_at > now() - make_interval(mins => s.pending_hold_minutes)))
  );
$$;

-- Start times a client can pick on a day for a shoot of p_hours (inside the hours, clear of other shoots + the gap).
create function public.get_free_slots(p_photographer uuid, p_day date, p_hours int)
returns setof time
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w record; s public.platform_settings; v_cur timestamp; v_limit timestamp; v_start timestamptz; v_end timestamptz;
begin
  if p_hours is null or p_hours < 1 or not public.is_approved_photographer(p_photographer) then return; end if;
  select * into s from public.platform_settings;
  select * into w from public.day_window(p_photographer, p_day);
  if w.start_t is null then return; end if;
  v_cur := p_day + w.start_t;
  v_limit := p_day + w.end_t;
  while v_cur + make_interval(hours => p_hours) <= v_limit loop
    v_start := v_cur at time zone 'Africa/Johannesburg';
    v_end := v_start + make_interval(hours => p_hours);
    if v_start > now() and not public.slot_conflicts(p_photographer, v_start, v_end) then
      return next v_cur::time;
    end if;
    v_cur := v_cur + make_interval(mins => s.slot_step_minutes);
  end loop;
end $$;

-- Replaces get_availability: open future days with how many start times are still free for a shoot of p_hours.
drop function public.get_availability(uuid, date, date);
create function public.get_open_days(p_photographer uuid, p_from date, p_to date, p_hours int)
returns table (day date, free_slots int, start_time time, end_time time)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.day,
         (select count(*)::int from public.get_free_slots(a.photographer_id, a.day, p_hours)),
         coalesce(a.start_time, pp.work_start),
         coalesce(a.end_time, pp.work_end)
    from public.availability a
    join public.photographer_profiles pp on pp.id = a.photographer_id and pp.verification_status = 'approved'
   where a.photographer_id = p_photographer and a.is_open
     and a.day between p_from and least(p_to, p_from + 62)
     and a.day > (now() at time zone 'Africa/Johannesburg')::date
   order by a.day;
$$;

-- create_booking: same as before, but the time must fall inside that day's hours and keep the gap to other shoots.
create or replace function public.create_booking(
  p_package_id uuid, p_shoot_date date, p_shoot_time time, p_location text, p_gateway public.pay_gateway
) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role; pk public.packages; pp public.photographer_profiles;
  w record; amt record; s public.platform_settings; v_start timestamptz; v_end timestamptz; b public.bookings;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'client' then raise exception 'only clients can make bookings'; end if;

  select * into pk from public.packages where id = p_package_id and is_active;
  if not found then raise exception 'package not available'; end if;
  select * into pp from public.photographer_profiles where id = pk.photographer_id;
  if pp.verification_status <> 'approved' then raise exception 'photographer is not accepting bookings'; end if;
  select * into s from public.platform_settings;

  v_start := (p_shoot_date + p_shoot_time) at time zone 'Africa/Johannesburg';
  if v_start <= now() then raise exception 'shoot must be in the future'; end if;
  v_end := v_start + make_interval(hours => pk.duration_hours);

  perform pg_advisory_xact_lock(hashtext(pp.id::text));   -- serialise bookings per photographer
  select * into w from public.day_window(pp.id, p_shoot_date);
  if w.start_t is null then raise exception 'photographer is not available on this date'; end if;
  if (p_shoot_date + p_shoot_time) < (p_shoot_date + w.start_t)
     or (p_shoot_date + p_shoot_time) + make_interval(hours => pk.duration_hours) > (p_shoot_date + w.end_t) then
    raise exception 'that time is outside the photographer''s available hours';
  end if;
  if public.slot_conflicts(pp.id, v_start, v_end) then raise exception 'that time slot is already booked'; end if;

  select * into amt from public.calc_amounts(pk.price_zar);
  insert into public.bookings (
    client_id, photographer_id, package_id, shoot_date, shoot_time, shoot_starts_at, shoot_ends_at, shoot_location,
    total_amount, platform_fee, transaction_fee, deposit_amount, tier_at_booking, gateway
  ) values (
    auth.uid(), pp.id, pk.id, p_shoot_date, p_shoot_time, v_start, v_end, coalesce(p_location, ''),
    pk.price_zar, amt.platform_fee, amt.transaction_fee,
    round(amt.net * case pp.tier when 3 then s.tier3_deposit_share when 2 then s.tier2_deposit_share
                                 else s.tier1_deposit_share end, 2),
    pp.tier, p_gateway
  ) returning * into b;
  return b;
end $$;

---------------------------------------------------------------------------
-- TEST MODE: simulated payment, fast-forward, delivery and withdrawal
---------------------------------------------------------------------------
-- Pays for the caller's own pending booking without a gateway. Same state change as the real webhook (confirm_payment).
create function public.simulate_payment(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  if not (select simulate_payments from public.platform_settings) then raise exception 'test payments are switched off'; end if;
  select * into b from public.bookings where id = p_booking;
  if not found or b.client_id is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  b := public.confirm_payment(p_booking, b.gateway, 'SIM-' || gen_random_uuid()::text, b.total_amount, jsonb_build_object('simulated', true));
  update public.bookings set simulated = true where id = b.id returning * into b;
  return b;
end $$;

-- "The shoot happened and 24 hours passed": moves the shoot into the past, then runs the payout engine.
create function public.simulate_shoot_done(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_len interval;
begin
  if not (select simulate_payments from public.platform_settings) then raise exception 'test mode is switched off'; end if;
  select * into b from public.bookings where id = p_booking for update;
  -- coalesce: for a client my_photographer_id() is NULL, and "NULL or false" must count as NOT allowed.
  if not found or not (coalesce(b.photographer_id = public.my_photographer_id(), false) or public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not b.simulated then raise exception 'only test bookings can be fast-forwarded'; end if;
  if b.status <> 'confirmed' then raise exception 'the shoot can only be fast-forwarded once, on a confirmed booking'; end if;
  v_len := b.shoot_ends_at - b.shoot_starts_at;
  update public.bookings set shoot_ends_at = now() - interval '25 hours', shoot_starts_at = now() - interval '25 hours' - v_len where id = b.id;
  perform public.process_booking_payouts(b.id);
  select * into b from public.bookings where id = p_booking;
  return b;
end $$;

-- "Photos delivered" without uploading anything (photo delivery is not built yet).
create function public.simulate_delivery(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  if not (select simulate_payments from public.platform_settings) then raise exception 'test mode is switched off'; end if;
  select * into b from public.bookings where id = p_booking for update;
  -- coalesce: for a client my_photographer_id() is NULL, and "NULL or false" must count as NOT allowed.
  if not found or not (coalesce(b.photographer_id = public.my_photographer_id(), false) or public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not b.simulated then raise exception 'only test bookings can be delivered without photos'; end if;
  if b.status not in ('confirmed', 'in_progress') then raise exception 'this booking is not ready for delivery'; end if;
  if b.shoot_ends_at > now() then raise exception 'mark the shoot as done first'; end if;
  update public.bookings
     set status = 'gallery_uploaded', gallery_uploaded_at = now(),
         gallery_expires_at = now() + make_interval(days => (select gallery_retention_days from public.platform_settings))
   where id = b.id;
  perform public.post_system_message(b.id, 'Your photos are ready to review. (Test delivery: no photos were uploaded.)');
  perform public.process_booking_payouts(b.id);
  select * into b from public.bookings where id = p_booking;
  return b;
end $$;

-- Withdraw everything that has been released to the photographer. Test payouts complete instantly with a SIM reference;
-- real ones become 'processing' and are completed by an admin after the EFT (admin_complete_payout).
create function public.request_withdrawal() returns table (r_total numeric, r_count int, r_reference text, r_completed boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pid uuid := public.my_photographer_id(); pp public.photographer_profiles;
  v_total numeric; v_n int; v_sim int; v_ref text; v_test boolean;
begin
  if v_pid is null then raise exception 'not a photographer account'; end if;
  select * into pp from public.photographer_profiles where id = v_pid;
  if not (pp.verification_status = 'approved' and pp.id_verified and pp.bank_verified) then
    raise exception 'add and verify your bank details before withdrawing'; end if;
  v_test := (select simulate_payments from public.platform_settings);

  with moved as (
    update public.payouts set status = 'processing', requested_at = now()
     where photographer_id = v_pid and status = 'pending'
     returning amount, simulated)
  select coalesce(sum(amount), 0), count(*)::int, (count(*) filter (where simulated))::int into v_total, v_n, v_sim from moved;
  if v_n = 0 then raise exception 'there is nothing available to withdraw'; end if;

  v_ref := null;
  if v_test and v_sim > 0 then
    v_ref := 'SIM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    update public.payouts set status = 'completed', completed_at = now(), bank_reference = v_ref
     where photographer_id = v_pid and status = 'processing' and simulated and requested_at = now();
  end if;
  return query select v_total, v_n, v_ref, (v_test and v_sim = v_n);
end $$;

-- Numbers for the photographer's dashboard / earnings screen.
create function public.my_earnings()
returns table (available numeric, processing numeric, paid_out numeric, in_escrow numeric, earned_this_month numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select public.my_photographer_id() as id)
  select
    coalesce((select sum(p.amount) from public.payouts p, me where p.photographer_id = me.id and p.status = 'pending'), 0),
    coalesce((select sum(p.amount) from public.payouts p, me where p.photographer_id = me.id and p.status = 'processing'), 0),
    coalesce((select sum(p.amount) from public.payouts p, me where p.photographer_id = me.id and p.status = 'completed'), 0),
    coalesce((select sum(b.total_amount - b.platform_fee - b.transaction_fee
                         - coalesce((select sum(p.amount) from public.payouts p where p.booking_id = b.id and p.status <> 'failed'), 0))
                from public.bookings b, me
               where b.photographer_id = me.id
                 and b.status in ('confirmed', 'in_progress', 'gallery_uploaded', 'disputed')
                 and b.payment_status in ('held', 'partially_released')), 0),
    coalesce((select sum(p.amount) from public.payouts p, me
               where p.photographer_id = me.id and p.status <> 'failed'
                 and p.created_at >= (date_trunc('month', now() at time zone 'Africa/Johannesburg')) at time zone 'Africa/Johannesburg'), 0);
$$;

---------------------------------------------------------------------------
-- Privileges
---------------------------------------------------------------------------
revoke execute on function public.day_window(uuid, date) from public, anon, authenticated;
revoke execute on function public.payout_inherit_simulated() from public, anon, authenticated;
revoke execute on function
  public.simulate_payment(uuid), public.simulate_shoot_done(uuid), public.simulate_delivery(uuid),
  public.request_withdrawal(), public.my_earnings()
from public, anon;
grant execute on function
  public.simulate_payment(uuid), public.simulate_shoot_done(uuid), public.simulate_delivery(uuid),
  public.request_withdrawal(), public.my_earnings()
to authenticated;
