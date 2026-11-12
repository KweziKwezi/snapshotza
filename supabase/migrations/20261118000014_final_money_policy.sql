-- SnapshotZA · 0014 · The final money policy: Saver vs Flexible rate, new fees, refunds, disputes, strikes, date changes
--
-- Implements docs/FEES_AND_REFUNDS_POLICY.md:
--   * commission 7% of the package price; payment processing 2.9% + R1.00 (both come out of the photographer's share)
--   * the client chooses a rate at checkout:  SAVER  = package price, no refund, no date change
--                                             FLEXIBLE = package price + R150 (kept by us), full refund of the package price
--                                                        if cancelled 48h+ before the shoot, one free date change
--   * photographer cancels / no-show = 100% refund incl. the flexible fee + a strike
--   * disputes: client wins = the unpaid share back (deposit stays); photographer wins = final payment; or a split
--   * strikes: 1 warning, 2 = 30-day suspension, 3 = removed
--   * refunds are tracked and due within 14 days; withdrawals start at R100
-- Safe to run once, after 0013.

---------------------------------------------------------------------------
-- Settings
---------------------------------------------------------------------------
alter table public.platform_settings
  add column transaction_fee_flat numeric(8,2) not null default 1.00,     -- the "+ R1.00" in 2.9% + R1.00
  add column flexible_fee         numeric(8,2) not null default 150.00,   -- extra price of the Flexible rate (never refunded)
  add column min_withdrawal       numeric(8,2) not null default 100.00,
  add column max_date_changes     int not null default 1,
  add column refund_days          int not null default 14,
  add column dispute_working_days int not null default 5,
  add column suspension_days      int not null default 30;
update public.platform_settings set platform_fee_rate = 0.07, transaction_fee_rate = 0.029;

create or replace function public.calc_amounts(p_total numeric, out platform_fee numeric, out transaction_fee numeric, out net numeric)
language sql stable as $$
  select round(p_total * s.platform_fee_rate, 2),
         round(p_total * s.transaction_fee_rate + s.transaction_fee_flat, 2),
         p_total - round(p_total * s.platform_fee_rate, 2) - round(p_total * s.transaction_fee_rate + s.transaction_fee_flat, 2)
  from public.platform_settings s;
$$;

---------------------------------------------------------------------------
-- Bookings remember the rate and the photographer's net
--   total_amount   = what the client pays (package price + flexible fee)
--   package_price  = the package price; commission, processing and the photographer's net are worked out from this
---------------------------------------------------------------------------
alter table public.bookings
  add column rate_type        text not null default 'flexible' check (rate_type in ('saver', 'flexible')),
  add column package_price    numeric(10,2),
  add column flex_fee         numeric(10,2) not null default 0,
  add column net_amount       numeric(10,2),
  add column rate_accepted_at timestamptz,
  add column date_changes     int not null default 0,
  add column forfeited_at     timestamptz,        -- cancelled with no refund: the photographer is paid once the shoot date has passed
  add column refund_due_by    timestamptz,
  add column refund_sent_at   timestamptz,
  add column refund_reference text;
update public.bookings set package_price = total_amount, net_amount = total_amount - platform_fee - transaction_fee;
alter table public.bookings alter column package_price set not null, alter column net_amount set not null;

alter table public.photographer_profiles add column suspended_until timestamptz;   -- 'infinity' = removed
alter table public.disputes add column decision_due_by timestamptz;

-- Photographers must not be able to lift their own suspension.
create or replace function public.guard_photographer_update() returns trigger language plpgsql as $$
begin
  if public.is_end_user() and not public.is_admin() then
    if (new.user_id, new.tier, new.total_bookings, new.average_rating, new.review_count,
        new.id_verified, new.bank_verified, new.verification_status, new.verification_note, new.strike_count, new.suspended_until)
       is distinct from
       (old.user_id, old.tier, old.total_bookings, old.average_rating, old.review_count,
        old.id_verified, old.bank_verified, old.verification_status, old.verification_note, old.strike_count, old.suspended_until) then
      raise exception 'protected photographer fields cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

---------------------------------------------------------------------------
-- Working days (for "a decision within 5 working days")
---------------------------------------------------------------------------
create function public.add_working_days(p_from timestamptz, p_days int) returns timestamptz
language plpgsql stable as $$
declare t timestamptz := p_from; n int := 0;
begin
  while n < p_days loop
    t := t + interval '1 day';
    if extract(isodow from (t at time zone 'Africa/Johannesburg')) < 6 then n := n + 1; end if;
  end loop;
  return t;
end $$;

create function public.disputes_set_due() returns trigger language plpgsql as $$
begin
  new.decision_due_by := public.add_working_days(now(), (select dispute_working_days from public.platform_settings));
  return new;
end $$;
create trigger disputes_set_due before insert on public.disputes
  for each row execute function public.disputes_set_due();

---------------------------------------------------------------------------
-- Strikes: 1 = warning, 2 = 30-day suspension, 3 = removed
---------------------------------------------------------------------------
create function public.apply_strike(p_photographer uuid, p_reason text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; v_pu uuid; s public.platform_settings;
begin
  select * into s from public.platform_settings;
  update public.photographer_profiles set strike_count = strike_count + 1 where id = p_photographer
    returning strike_count, user_id into n, v_pu;
  if n = 1 then
    perform public.notify(v_pu, 'strike', 'Warning: strike 1 of 3',
      format('You received a strike because you %s. A second strike suspends your account for %s days; a third removes it.', p_reason, s.suspension_days));
  elsif n = 2 then
    update public.photographer_profiles set verification_status = 'suspended', suspended_until = now() + make_interval(days => s.suspension_days)
     where id = p_photographer;
    perform public.notify(v_pu, 'strike', 'Strike 2 of 3: account suspended',
      format('You received a second strike because you %s. Your account is suspended for %s days. A third strike removes it permanently. You can appeal with valid proof.', p_reason, s.suspension_days));
  else
    update public.photographer_profiles set verification_status = 'suspended', suspended_until = 'infinity' where id = p_photographer;
    perform public.notify(v_pu, 'strike', 'Strike 3 of 3: account removed',
      format('You received a third strike because you %s. Your account has been removed from SnapshotZA. You can appeal with valid proof.', p_reason));
  end if;
  perform public.notify_admins('strike', 'Photographer strike', format('Strike %s was applied because the photographer %s.', n, p_reason));
  return n;
end $$;

create function public.lift_suspensions() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.photographer_profiles
     set verification_status = 'approved', suspended_until = null
   where verification_status = 'suspended' and suspended_until is not null
     and suspended_until <> 'infinity' and suspended_until <= now() and id_verified;
  get diagnostics n = row_count;
  return n;
end $$;

---------------------------------------------------------------------------
-- Date changes (Flexible rate only; the photographer approves)
---------------------------------------------------------------------------
create table public.reschedule_requests (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  requested_by uuid not null references public.profiles (id),
  new_date     date not null,
  new_time     time not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'expired', 'cancelled')),
  note         text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index on public.reschedule_requests (booking_id, status);
alter table public.reschedule_requests enable row level security;
create policy reschedule_select on public.reschedule_requests for select to authenticated
  using (public.is_booking_party(booking_id) or public.is_admin());
revoke all on public.reschedule_requests from anon;
revoke insert, update, delete, truncate on public.reschedule_requests from authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.reschedule_requests;
  end if;
end $$;

-- One place that decides "is this slot bookable?" (used by new bookings and by date changes).
create function public.assert_slot_free(p_photographer uuid, p_date date, p_time time, p_hours int, p_exclude uuid default null)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare w record; v_start timestamptz; v_end timestamptz;
begin
  v_start := (p_date + p_time) at time zone 'Africa/Johannesburg';
  if v_start <= now() then raise exception 'shoot must be in the future'; end if;
  v_end := v_start + make_interval(hours => p_hours);
  select * into w from public.day_window(p_photographer, p_date);
  if w.start_t is null then raise exception 'photographer is not available on this date'; end if;
  if (p_date + p_time) < (p_date + w.start_t) or (p_date + p_time) + make_interval(hours => p_hours) > (p_date + w.end_t) then
    raise exception 'that time is outside the photographer''s available hours';
  end if;
  if public.slot_conflicts(p_photographer, v_start, v_end, p_exclude) then raise exception 'that time slot is already booked'; end if;
  return v_start;
end $$;

---------------------------------------------------------------------------
-- Booking: the client chooses a rate
---------------------------------------------------------------------------
drop function public.create_booking(uuid, date, time, text, public.pay_gateway);
create function public.create_booking(
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
-- The release engine and earnings now use the photographer's net
---------------------------------------------------------------------------
create or replace function public.process_booking_payouts(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.bookings; s public.platform_settings; pp public.photographer_profiles;
  v_net numeric; v_released numeric; v_amt numeric;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then return; end if;
  if b.status not in ('confirmed', 'in_progress', 'gallery_uploaded')
     or b.payment_status not in ('held', 'partially_released') then return; end if;

  select * into s from public.platform_settings;
  select * into pp from public.photographer_profiles where id = b.photographer_id;
  if not (pp.verification_status = 'approved' and pp.id_verified and pp.bank_verified) then return; end if;
  v_net := b.net_amount;

  if b.deposit_released_at is null and b.no_show_reported_at is null
     and (b.shoot_confirmed_at is not null
          or (b.shoot_completed_at is not null
              and now() >= b.shoot_completed_at + make_interval(hours => s.post_shoot_release_hours))) then
    insert into public.payouts (photographer_id, booking_id, amount, type)
    values (b.photographer_id, b.id, b.deposit_amount, 'deposit_release');
    update public.bookings
       set deposit_released_at = now(), payment_status = 'partially_released',
           status = case when status = 'confirmed' then 'in_progress' else status end
     where id = b.id returning * into b;
    perform public.post_system_message(b.id, 'Shoot confirmed. The first part of the payment has been released to your photographer.');
  end if;

  if b.status = 'gallery_uploaded' and b.deposit_released_at is not null
     and (b.gallery_approved_at is not null
          or now() >= b.gallery_uploaded_at + make_interval(hours => s.review_window_hours)) then
    select coalesce(sum(amount), 0) into v_released from public.payouts where booking_id = b.id and status <> 'failed';
    v_amt := v_net - v_released;
    if v_amt > 0 then
      insert into public.payouts (photographer_id, booking_id, amount, type)
      values (b.photographer_id, b.id, v_amt, 'final_release');
    end if;
    update public.bookings set final_released_at = now(), payment_status = 'fully_released', status = 'completed' where id = b.id;
    perform public.post_system_message(b.id, 'Booking complete. Payment released. How was your experience?');
  end if;
end $$;

drop function public.my_earnings();
create function public.my_earnings()
returns table (available numeric, on_hold numeric, processing numeric, paid_out numeric, in_escrow numeric, earned_this_month numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select public.my_photographer_id() as id)
  select
    coalesce((select sum(p.amount) from public.payouts p, me where p.photographer_id = me.id and p.status = 'pending' and not p.frozen), 0),
    coalesce((select sum(p.amount) from public.payouts p, me where p.photographer_id = me.id and p.status = 'pending' and p.frozen), 0),
    coalesce((select sum(p.amount) from public.payouts p, me where p.photographer_id = me.id and p.status = 'processing'), 0),
    coalesce((select sum(p.amount) from public.payouts p, me where p.photographer_id = me.id and p.status = 'completed'), 0),
    coalesce((select sum(b.net_amount
                         - coalesce((select sum(p.amount) from public.payouts p where p.booking_id = b.id and p.status <> 'failed'), 0))
                from public.bookings b, me
               where b.photographer_id = me.id
                 and (b.status in ('confirmed', 'in_progress', 'gallery_uploaded', 'disputed')
                      or (b.status = 'cancelled' and b.forfeited_at is not null))
                 and b.payment_status in ('held', 'partially_released')), 0),
    coalesce((select sum(p.amount) from public.payouts p, me
               where p.photographer_id = me.id and p.status <> 'failed'
                 and p.created_at >= (date_trunc('month', now() at time zone 'Africa/Johannesburg')) at time zone 'Africa/Johannesburg'), 0);
$$;

create or replace function public.request_withdrawal() returns table (r_total numeric, r_count int, r_reference text, r_completed boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pid uuid := public.my_photographer_id(); pp public.photographer_profiles; v_acct public.payout_accounts;
  v_total numeric; v_avail numeric; v_n int; v_sim int; v_sim_total numeric; v_real_total numeric; v_ref text; v_test boolean;
begin
  if v_pid is null then raise exception 'not a photographer account'; end if;
  select * into pp from public.photographer_profiles where id = v_pid;
  if not (pp.verification_status = 'approved' and pp.id_verified and pp.bank_verified) then
    raise exception 'add and verify your bank details before withdrawing'; end if;
  select * into v_acct from public.payout_accounts where photographer_id = v_pid;
  v_test := (select simulate_payments from public.platform_settings);

  select coalesce(sum(amount), 0) into v_avail from public.payouts where photographer_id = v_pid and status = 'pending' and not frozen;
  if v_avail > 0 and v_avail < (select min_withdrawal from public.platform_settings) then
    raise exception 'the minimum withdrawal is %', public.zar((select min_withdrawal from public.platform_settings));
  end if;

  with moved as (
    update public.payouts set status = 'processing', requested_at = now()
     where photographer_id = v_pid and status = 'pending' and not frozen
     returning amount, simulated)
  select coalesce(sum(amount), 0), count(*)::int, (count(*) filter (where simulated))::int,
         coalesce(sum(amount) filter (where simulated), 0)
    into v_total, v_n, v_sim, v_sim_total from moved;
  if v_n = 0 then raise exception 'there is nothing available to withdraw'; end if;

  v_ref := null;
  if v_test and v_sim > 0 then
    v_ref := 'SIM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    update public.payouts set status = 'completed', completed_at = now(), bank_reference = v_ref
     where photographer_id = v_pid and status = 'processing' and simulated and requested_at = now();
    perform public.notify(auth.uid(), 'payout_sent', 'Money sent',
      format('%s was sent to your %s account ending %s (reference %s). Test withdrawal: no real money moved.',
             public.zar(v_sim_total), v_acct.bank_name, v_acct.account_last4, v_ref));
  end if;
  v_real_total := v_total - case when v_test then v_sim_total else 0 end;
  if v_real_total > 0 then
    perform public.notify(auth.uid(), 'payout_processing', 'Withdrawal on its way',
      format('We are sending %s to your %s account ending %s. It will be sent shortly, and you will get a notification when it has been sent.',
             public.zar(v_real_total), v_acct.bank_name, v_acct.account_last4));
  end if;
  return query select v_total, v_n, v_ref, (v_test and v_sim = v_n);
end $$;

---------------------------------------------------------------------------
-- Client / photographer cancels
---------------------------------------------------------------------------
create or replace function public.cancel_booking(p_booking uuid, p_reason text default '') returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; s public.platform_settings; v_is_client boolean; v_is_photog boolean;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'booking not found'; end if;
  v_is_client := coalesce(b.client_id = auth.uid(), false);
  v_is_photog := coalesce(b.photographer_id = public.my_photographer_id(), false);
  if not (v_is_client or v_is_photog) then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'this booking can no longer be cancelled - report an issue instead';
  end if;
  select * into s from public.platform_settings;

  update public.reschedule_requests set status = 'cancelled', decided_at = now() where booking_id = b.id and status = 'pending';

  if b.status = 'pending' then
    update public.bookings set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
     where id = b.id returning * into b;
    return b;
  end if;

  if v_is_photog then
    -- 100% back, including the flexible fee; the photographer earns nothing and gets a strike.
    update public.bookings set status = 'cancelled', payment_status = 'refunded', refund_amount = b.total_amount,
           refund_due_by = now() + make_interval(days => s.refund_days),
           cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
     where id = b.id returning * into b;
    perform public.apply_strike(b.photographer_id, 'cancelled a paid booking');
    perform public.post_system_message(b.id, format('Your photographer cancelled. You will receive a full refund of %s within %s days.', public.zar(b.total_amount), s.refund_days));
  elsif b.rate_type = 'flexible' and b.shoot_starts_at - now() >= make_interval(hours => s.free_cancel_hours) then
    -- Flexible, 48h or more ahead: the package price comes back. The flexible fee pays for the refund and is kept.
    update public.bookings set status = 'cancelled', payment_status = 'refunded', refund_amount = b.package_price,
           refund_due_by = now() + make_interval(days => s.refund_days),
           cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
     where id = b.id returning * into b;
    perform public.post_system_message(b.id, format('Booking cancelled. Your refund of %s will be paid within %s days (the %s flexible-rate fee is not refundable).',
                                                    public.zar(b.package_price), s.refund_days, public.zar(b.flex_fee)));
  else
    -- No refund: the Saver rate, or a Flexible booking inside the 48-hour window. The photographer held the date and
    -- is paid their full net once the shoot date has passed.
    update public.bookings set status = 'cancelled', forfeited_at = now(),
           cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
     where id = b.id returning * into b;
    perform public.post_system_message(b.id, case when b.rate_type = 'saver'
      then 'Booking cancelled. The Saver rate has no refund: the photographer is paid for holding the date.'
      else 'Booking cancelled less than 48 hours before the shoot, so there is no refund: the photographer is paid for holding the date.' end);
  end if;
  return b;
end $$;

-- Cancelled with no refund: pay the photographer their full net once the shoot date has passed.
create function public.release_forfeit(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; pp public.photographer_profiles;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.status <> 'cancelled' or b.forfeited_at is null or b.payment_status <> 'held' or now() < b.shoot_ends_at then return; end if;
  select * into pp from public.photographer_profiles where id = b.photographer_id;
  if not (pp.id_verified and pp.bank_verified) then return; end if;
  insert into public.payouts (photographer_id, booking_id, amount, type) values (b.photographer_id, b.id, b.net_amount, 'final_release');
  update public.bookings set payment_status = 'fully_released', final_released_at = now() where id = b.id;
end $$;

---------------------------------------------------------------------------
-- Disputes: client wins = the unpaid share back (deposit stays), photographer wins = final payment, or a split
---------------------------------------------------------------------------
drop function public.admin_resolve_dispute(uuid, text, text);
create function public.admin_resolve_dispute(p_dispute uuid, p_outcome text, p_note text default '', p_client_pct int default null)
returns public.disputes
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.disputes; b public.bookings; s public.platform_settings;
  v_released numeric; v_refund numeric; v_client numeric; v_photog numeric; v_pu uuid; v_note text;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into d from public.disputes where id = p_dispute for update;
  if not found then raise exception 'dispute not found'; end if;
  if d.status in ('resolved_client', 'resolved_photographer', 'closed') then raise exception 'dispute already resolved'; end if;
  select * into b from public.bookings where id = d.booking_id for update;
  select * into s from public.platform_settings;
  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  v_note := case when length(trim(coalesce(p_note, ''))) > 0 then ' Note from our team: ' || trim(p_note) else '' end;

  if p_outcome = 'refund_client' and d.type = 'photographer_no_show' then
    -- The shoot did not happen: everything not yet paid out comes back, including the flexible fee. Strike for the photographer.
    update public.payouts set status = 'failed' where booking_id = b.id and status = 'pending';
    select coalesce(sum(amount), 0) into v_released from public.payouts where booking_id = b.id and status <> 'failed';
    v_refund := b.total_amount - v_released;
    update public.bookings set status = 'cancelled', payment_status = 'refunded', refund_amount = v_refund,
           refund_due_by = now() + make_interval(days => s.refund_days),
           cancelled_at = now(), cancellation_reason = 'photographer did not show up' where id = b.id;
    perform public.apply_strike(b.photographer_id, 'did not show up for a booking');
    update public.disputes set status = 'resolved_client' where id = d.id;
    perform public.notify(b.client_id, 'issue_resolved', 'Your report was upheld',
      format('The photographer did not show up. Booking %s was cancelled and you will be refunded %s within %s days.%s', b.booking_ref, public.zar(v_refund), s.refund_days, v_note), b.id);
    perform public.notify(v_pu, 'issue_resolved', 'Report decided',
      format('After review, booking %s was cancelled because you did not show up. You have received a strike.%s', b.booking_ref, v_note), b.id);

  elsif p_outcome = 'refund_client' then
    -- Deposits are never refunded: whatever was released (even if not yet withdrawn) stays with the photographer.
    update public.payouts set frozen = false where booking_id = b.id;
    select coalesce(sum(amount), 0) into v_released from public.payouts where booking_id = b.id and status <> 'failed';
    v_refund := round(b.package_price - v_released * b.package_price / b.net_amount, 2);
    update public.bookings set status = 'cancelled', payment_status = 'refunded', refund_amount = v_refund,
           refund_due_by = now() + make_interval(days => s.refund_days),
           cancelled_at = now(), cancellation_reason = 'dispute resolved in favour of client' where id = b.id;
    update public.disputes set status = 'resolved_client' where id = d.id;
    perform public.notify(b.client_id, 'issue_resolved', 'Your report was upheld',
      format('Booking %s was closed and you will be refunded %s within %s days. The first payment already released to the photographer is not refundable.%s', b.booking_ref, public.zar(v_refund), s.refund_days, v_note), b.id);
    perform public.notify(v_pu, 'issue_resolved', 'Report decided',
      format('After review, the final payment for booking %s was refunded to the client. You keep the first payment.%s', b.booking_ref, v_note), b.id);

  elsif p_outcome = 'pay_photographer' then
    select coalesce(sum(amount), 0) into v_released from public.payouts where booking_id = b.id and status <> 'failed';
    v_photog := b.net_amount - v_released;
    update public.payouts set frozen = false where booking_id = b.id;
    if v_photog > 0 then
      insert into public.payouts (photographer_id, booking_id, amount, type) values (b.photographer_id, b.id, v_photog, 'final_release');
    end if;
    update public.bookings set status = 'completed', payment_status = 'fully_released', final_released_at = now(),
           shoot_confirmed_at = coalesce(shoot_confirmed_at, now()) where id = b.id;
    update public.disputes set status = 'resolved_photographer' where id = d.id;
    perform public.notify(v_pu, 'issue_resolved', 'Report decided in your favour',
      format('The payment for booking %s has been released to you.%s', b.booking_ref, v_note), b.id);
    perform public.notify(b.client_id, 'issue_resolved', 'Your report was reviewed',
      format('After review, booking %s was completed as delivered.%s', b.booking_ref, v_note), b.id);

  elsif p_outcome = 'split' then
    if p_client_pct is null or p_client_pct < 1 or p_client_pct > 99 then raise exception 'a split needs the client''s share between 1 and 99 percent'; end if;
    update public.payouts set frozen = false where booking_id = b.id;
    select coalesce(sum(amount), 0) into v_released from public.payouts where booking_id = b.id and status <> 'failed';
    v_client := round(round(b.package_price - v_released * b.package_price / b.net_amount, 2) * p_client_pct / 100, 2);
    v_photog := round((b.net_amount - v_released) * (100 - p_client_pct) / 100, 2);
    if v_photog > 0 then
      insert into public.payouts (photographer_id, booking_id, amount, type) values (b.photographer_id, b.id, v_photog, 'final_release');
    end if;
    update public.bookings set status = 'completed', payment_status = 'fully_released', final_released_at = now(),
           refund_amount = v_client, refund_due_by = now() + make_interval(days => s.refund_days),
           shoot_confirmed_at = coalesce(shoot_confirmed_at, now()) where id = b.id;
    update public.disputes set status = (case when p_client_pct >= 50 then 'resolved_client' else 'resolved_photographer' end)::public.dispute_status where id = d.id;
    perform public.notify(b.client_id, 'issue_resolved', 'Your report was decided',
      format('After review, you will be refunded %s within %s days for booking %s.%s', public.zar(v_client), s.refund_days, b.booking_ref, v_note), b.id);
    perform public.notify(v_pu, 'issue_resolved', 'Report decided',
      format('After review, %s of the final payment for booking %s has been released to you.%s', public.zar(v_photog), b.booking_ref, v_note), b.id);

  elsif p_outcome = 'dismiss' then
    update public.payouts set frozen = false where booking_id = b.id;
    update public.bookings set status = coalesce(status_before_dispute, 'confirmed'), status_before_dispute = null, no_show_reported_at = null
     where id = b.id;
    update public.disputes set status = 'closed' where id = d.id;
    perform public.notify(b.client_id, 'issue_resolved', 'Report closed',
      format('After review, no action was needed on booking %s. The booking continues as normal.%s', b.booking_ref, v_note), b.id);
    perform public.notify(v_pu, 'issue_resolved', 'Report closed',
      format('After review, no action was needed on booking %s. The booking continues as normal.%s', b.booking_ref, v_note), b.id);
  else
    raise exception 'unknown outcome %', p_outcome;
  end if;

  -- A dispute must not eat the client's download window: guarantee at least 7 days after resolution.
  update public.bookings set gallery_expires_at = greatest(gallery_expires_at, now() + interval '7 days')
   where id = b.id and gallery_expires_at is not null and gallery_purged_at is null;
  update public.disputes set resolution = p_note, resolved_by = auth.uid(), resolved_at = now() where id = d.id returning * into d;
  perform public.post_system_message(b.id, 'Your report has been reviewed and resolved by SnapshotZA.');
  return d;
end $$;
revoke all on function public.admin_resolve_dispute(uuid, text, text, int) from public, anon;
grant execute on function public.admin_resolve_dispute(uuid, text, text, int) to authenticated;

---------------------------------------------------------------------------
-- Refunds are tracked: an admin sends them and marks them sent
---------------------------------------------------------------------------
create function public.admin_mark_refund_sent(p_booking uuid, p_reference text) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.bookings set refund_sent_at = now(), refund_reference = nullif(trim(p_reference), '')
   where id = p_booking and coalesce(refund_amount, 0) > 0 and refund_sent_at is null returning * into b;
  if not found then raise exception 'no refund is waiting on that booking'; end if;
  perform public.notify(b.client_id, 'refund_sent', 'Your refund was sent',
    format('%s for booking %s was sent back to your original payment method%s.', public.zar(b.refund_amount), b.booking_ref,
           case when b.refund_reference is not null then ' (reference ' || b.refund_reference || ')' else '' end), b.id);
  return b;
end $$;
revoke all on function public.admin_mark_refund_sent(uuid, text) from public, anon;
grant execute on function public.admin_mark_refund_sent(uuid, text) to authenticated;

---------------------------------------------------------------------------
-- Date change requests
---------------------------------------------------------------------------
create function public.request_reschedule(p_booking uuid, p_date date, p_time time) returns public.reschedule_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; s public.platform_settings; pk public.packages; r public.reschedule_requests; v_start timestamptz; v_pu uuid;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.client_id is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.platform_settings;
  perform public.expire_reschedules();                         -- an old unanswered request must not block a new one
  if b.status <> 'confirmed' then raise exception 'only a paid booking that has not started can be moved'; end if;
  if b.rate_type <> 'flexible' then raise exception 'date changes are only available with the Flexible rate'; end if;
  if b.date_changes >= s.max_date_changes then raise exception 'you have already used your free date change'; end if;
  if b.shoot_starts_at - now() < make_interval(hours => s.free_cancel_hours) then
    raise exception 'date changes must be requested at least % hours before the shoot', s.free_cancel_hours; end if;
  if exists (select 1 from public.reschedule_requests where booking_id = b.id and status = 'pending') then
    raise exception 'you already have a date change waiting for your photographer'; end if;
  select * into pk from public.packages where id = b.package_id;
  v_start := public.assert_slot_free(b.photographer_id, p_date, p_time, pk.duration_hours, b.id);
  if v_start - now() < make_interval(hours => s.free_cancel_hours) then
    raise exception 'pick a new time at least % hours from now', s.free_cancel_hours; end if;

  insert into public.reschedule_requests (booking_id, requested_by, new_date, new_time) values (b.id, auth.uid(), p_date, p_time) returning * into r;
  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  perform public.notify(v_pu, 'reschedule_request', 'Date change requested',
    format('Your client asked to move booking %s from %s to %s at %s. Please approve or decline within %s hours.',
           b.booking_ref, to_char(b.shoot_starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon "at" HH24:MI'),
           to_char(p_date, 'Dy DD Mon'), to_char(p_time, 'HH24:MI'), s.free_cancel_hours), b.id);
  return r;
end $$;

create function public.decide_reschedule(p_request uuid, p_approve boolean, p_note text default '') returns public.reschedule_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.reschedule_requests; b public.bookings; s public.platform_settings; pk public.packages; v_start timestamptz; v_pu uuid;
begin
  select * into r from public.reschedule_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  select * into b from public.bookings where id = r.booking_id for update;
  if b.photographer_id is distinct from public.my_photographer_id() then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'this request has already been answered'; end if;
  select * into s from public.platform_settings;
  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  if r.created_at + make_interval(hours => s.free_cancel_hours) <= now() or b.status <> 'confirmed' or b.shoot_starts_at <= now() then
    update public.reschedule_requests set status = 'expired', decided_at = now() where id = r.id;
    raise exception 'this request has expired';
  end if;

  if p_approve then
    select * into pk from public.packages where id = b.package_id;
    v_start := public.assert_slot_free(b.photographer_id, r.new_date, r.new_time, pk.duration_hours, b.id);
    update public.bookings
       set shoot_date = r.new_date, shoot_time = r.new_time, shoot_starts_at = v_start,
           shoot_ends_at = v_start + make_interval(hours => pk.duration_hours), date_changes = date_changes + 1
     where id = b.id;
    update public.reschedule_requests set status = 'approved', decided_at = now(), note = nullif(trim(p_note), '') where id = r.id returning * into r;
    perform public.post_system_message(b.id, format('The shoot was moved to %s.', to_char(v_start at time zone 'Africa/Johannesburg', 'Dy DD Mon "at" HH24:MI')));
    perform public.notify(b.client_id, 'reschedule_approved', 'Date change approved',
      format('Your photographer approved the new date: %s.', to_char(v_start at time zone 'Africa/Johannesburg', 'Dy DD Mon "at" HH24:MI')), b.id);
  else
    update public.reschedule_requests set status = 'declined', decided_at = now(), note = nullif(trim(p_note), '') where id = r.id returning * into r;
    perform public.notify(b.client_id, 'reschedule_declined', 'Date change declined',
      format('Your photographer could not move booking %s to the new date. The booking stays on %s.%s', b.booking_ref,
             to_char(b.shoot_starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon "at" HH24:MI'),
             case when nullif(trim(p_note), '') is not null then ' They said: ' || trim(p_note) else '' end), b.id);
  end if;
  return r;
end $$;

create function public.cancel_reschedule(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.reschedule_requests set status = 'cancelled', decided_at = now()
   where id = p_request and requested_by = auth.uid() and status = 'pending';
  if not found then raise exception 'request not found'; end if;
end $$;

create function public.expire_reschedules() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0; s public.platform_settings;
begin
  select * into s from public.platform_settings;
  for r in select q.id, q.booking_id, b.client_id, b.booking_ref from public.reschedule_requests q join public.bookings b on b.id = q.booking_id
            where q.status = 'pending' and (q.created_at + make_interval(hours => s.free_cancel_hours) <= now() or b.shoot_starts_at <= now() or b.status <> 'confirmed') loop
    update public.reschedule_requests set status = 'expired', decided_at = now() where id = r.id;
    perform public.notify(r.client_id, 'reschedule_declined', 'Date change expired',
      format('Your photographer did not answer in time, so booking %s stays on its original date. You can ask again with a different date.', r.booking_ref), r.booking_id);
    n := n + 1;
  end loop;
  return n;
end $$;

---------------------------------------------------------------------------
-- The scheduled job also pays forfeited bookings, expires date changes and lifts finished suspensions
---------------------------------------------------------------------------
create or replace function public.process_due_payouts() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_before int; v_after int;
begin
  select count(*) into v_before from public.payouts;
  for r in select id from public.bookings
            where status in ('confirmed', 'in_progress', 'gallery_uploaded')
              and payment_status in ('held', 'partially_released') loop
    perform public.process_booking_payouts(r.id);
  end loop;
  for r in select id from public.bookings
            where status = 'cancelled' and forfeited_at is not null and payment_status = 'held' and shoot_ends_at <= now() loop
    perform public.release_forfeit(r.id);
  end loop;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'payment not received'
   where status = 'pending' and created_at < now() - interval '24 hours';
  perform public.expire_reschedules();
  perform public.lift_suspensions();
  select count(*) into v_after from public.payouts;
  return v_after - v_before;
end $$;

---------------------------------------------------------------------------
-- Privileges
---------------------------------------------------------------------------
revoke all on function
  public.apply_strike(uuid, text), public.lift_suspensions(), public.release_forfeit(uuid), public.expire_reschedules(),
  public.assert_slot_free(uuid, date, time, int, uuid), public.add_working_days(timestamptz, int)
from public, anon, authenticated;
grant execute on function public.lift_suspensions(), public.expire_reschedules() to service_role;
revoke all on function public.request_reschedule(uuid, date, time), public.decide_reschedule(uuid, boolean, text), public.cancel_reschedule(uuid) from public, anon;
grant execute on function public.request_reschedule(uuid, date, time), public.decide_reschedule(uuid, boolean, text), public.cancel_reschedule(uuid) to authenticated;
revoke all on function public.my_earnings() from public, anon;
grant execute on function public.my_earnings() to authenticated;
