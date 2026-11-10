-- SnapshotZA · 0002 · Business logic (escrow, tiers, payouts, cancellations, disputes)
-- All state changes to money/bookings go through the functions below, never via direct table writes.

---------------------------------------------------------------------------
-- Helpers
---------------------------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- True for API callers (anon / authenticated). False for service_role, postgres, cron, and
-- for code running inside SECURITY DEFINER functions. Used by guard triggers.
create function public.is_end_user() returns boolean
language sql stable as $$ select current_user in ('anon', 'authenticated'); $$;

create function public.my_photographer_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.photographer_profiles where user_id = auth.uid();
$$;

create function public.is_booking_party(p_booking uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking
      and (b.client_id = auth.uid() or b.photographer_id = public.my_photographer_id())
  );
$$;

-- Contact details unlock once a booking is paid (and not cancelled).
create function public.can_see_contact(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.bookings b
    join public.photographer_profiles pp on pp.id = b.photographer_id
    where b.payment_status <> 'pending' and b.status <> 'cancelled'
      and ((b.client_id = auth.uid() and pp.user_id = p_user)
        or (pp.user_id = auth.uid() and b.client_id = p_user))
  );
$$;

create function public.has_booking_with_photographer(p_photographer uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.bookings where client_id = auth.uid() and photographer_id = p_photographer);
$$;

create function public.calc_amounts(p_total numeric, out platform_fee numeric, out transaction_fee numeric, out net numeric)
language sql stable as $$
  select round(p_total * s.platform_fee_rate, 2),
         round(p_total * s.transaction_fee_rate, 2),
         p_total - round(p_total * s.platform_fee_rate, 2) - round(p_total * s.transaction_fee_rate, 2)
  from public.platform_settings s;
$$;

create function public.slot_conflicts(p_photographer uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.bookings b cross join public.platform_settings s
    where b.photographer_id = p_photographer
      and b.id is distinct from p_exclude
      and tstzrange(b.shoot_starts_at, b.shoot_ends_at) && tstzrange(p_start, p_end)
      and (b.status in ('confirmed', 'in_progress', 'gallery_uploaded', 'disputed')
           or (b.status = 'pending' and b.created_at > now() - make_interval(mins => s.pending_hold_minutes)))
  );
$$;

create function public.post_system_message(p_booking uuid, p_text text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.chat_messages (booking_id, sender_id, message_type, content)
  values (p_booking, null, 'system', p_text);
$$;

---------------------------------------------------------------------------
-- New user -> profile (role can only ever be client or photographer from signup)
---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role public.user_role := 'client';
begin
  if new.raw_user_meta_data ->> 'role' = 'photographer' then v_role := 'photographer'; end if;
  insert into public.profiles (id, role, email, phone, full_name)
  values (new.id, v_role, new.email, new.phone, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  if v_role = 'photographer' then
    insert into public.photographer_profiles (user_id) values (new.id);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

---------------------------------------------------------------------------
-- Guard triggers: users may edit their own rows, but not trust/verification fields
---------------------------------------------------------------------------
create function public.guard_profile_update() returns trigger language plpgsql as $$
begin
  if public.is_end_user() and not public.is_admin() then
    if new.role is distinct from old.role or new.id is distinct from old.id then
      raise exception 'role cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

create function public.guard_photographer_update() returns trigger language plpgsql as $$
begin
  if public.is_end_user() and not public.is_admin() then
    if (new.user_id, new.tier, new.total_bookings, new.average_rating, new.review_count,
        new.id_verified, new.bank_verified, new.verification_status, new.verification_note, new.strike_count)
       is distinct from
       (old.user_id, old.tier, old.total_bookings, old.average_rating, old.review_count,
        old.id_verified, old.bank_verified, old.verification_status, old.verification_note, old.strike_count) then
      raise exception 'protected photographer fields cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_photographer_update before update on public.photographer_profiles
  for each row execute function public.guard_photographer_update();

-- Changing bank details removes the verified flag until an admin re-verifies (FICA).
-- Two triggers on purpose: the BEFORE trigger must run with the caller's rights so is_end_user() works
-- (inside a SECURITY DEFINER function current_user is the owner, which would disable the guard).
create function public.guard_payout_account() returns trigger language plpgsql as $$
begin
  if public.is_end_user() and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.verified_at := null;                         -- cannot create an already-verified account
    elsif (new.bank_name, new.account_holder, new.account_number, new.branch_code, new.account_type)
          is distinct from (old.bank_name, old.account_holder, old.account_number, old.branch_code, old.account_type) then
      new.verified_at := null;                         -- details changed: needs re-verification
    else
      new.verified_at := old.verified_at;              -- cannot self-verify
    end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
create trigger guard_payout_account before insert or update on public.payout_accounts
  for each row execute function public.guard_payout_account();

create function public.sync_bank_verified() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.verified_at is null then
    update public.photographer_profiles set bank_verified = false where id = new.photographer_id and bank_verified;
  end if;
  return null;
end $$;
create trigger sync_bank_verified after insert or update on public.payout_accounts
  for each row execute function public.sync_bank_verified();

---------------------------------------------------------------------------
-- Reputation: recompute stats and auto-promote to Tier 2
---------------------------------------------------------------------------
create function public.refresh_photographer_stats(p_photographer uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.platform_settings;
begin
  select * into s from public.platform_settings;
  update public.photographer_profiles pp set
    total_bookings = (select count(*) from public.bookings where photographer_id = pp.id and status = 'completed'),
    review_count   = (select count(*) from public.reviews  where photographer_id = pp.id),
    average_rating = coalesce((select round(avg(rating), 2) from public.reviews where photographer_id = pp.id), 0)
  where pp.id = p_photographer;
  -- Promotion only: one tier per bookings_per_tier completed bookings, capped at Tier 3.
  -- Demotion is an admin decision. The rating gate applies once the photographer has any reviews.
  update public.photographer_profiles
     set tier = least(3, 1 + total_bookings / s.bookings_per_tier)
   where id = p_photographer
     and tier < least(3, 1 + total_bookings / s.bookings_per_tier)
     and (review_count = 0 or average_rating >= s.tier_min_rating);
end $$;

create function public.on_booking_completed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.refresh_photographer_stats(new.photographer_id);
  end if;
  return new;
end $$;
create trigger on_booking_completed after update of status on public.bookings
  for each row execute function public.on_booking_completed();

---------------------------------------------------------------------------
-- Booking lifecycle
---------------------------------------------------------------------------
create function public.create_booking(
  p_package_id uuid, p_shoot_date date, p_shoot_time time, p_location text, p_gateway public.pay_gateway
) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role; pk public.packages; pp public.photographer_profiles; s public.platform_settings;
  amt record; v_start timestamptz; v_end timestamptz; b public.bookings;
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
  if not exists (select 1 from public.availability where photographer_id = pp.id and day = p_shoot_date and is_open) then
    raise exception 'photographer is not available on this date';
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

-- Called ONLY by the payment webhook (service role) after the gateway signature is verified.
create function public.confirm_payment(
  p_booking uuid, p_gateway public.pay_gateway, p_reference text, p_amount numeric, p_payload jsonb default null
) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'booking not found'; end if;
  if exists (select 1 from public.payments where gateway = p_gateway and gateway_reference = p_reference and booking_id = b.id) then
    return b;                                              -- webhook retry for the same booking: idempotent
  end if;
  if exists (select 1 from public.payments where gateway = p_gateway and gateway_reference = p_reference) then
    raise exception 'payment reference % was already used for another booking', p_reference;
  end if;
  if b.status <> 'pending' then raise exception 'booking is not awaiting payment (status %)', b.status; end if;
  if p_amount <> b.total_amount then raise exception 'amount mismatch: expected %, got %', b.total_amount, p_amount; end if;
  if public.slot_conflicts(b.photographer_id, b.shoot_starts_at, b.shoot_ends_at, b.id) then
    raise exception 'slot no longer available - refund required';
  end if;

  insert into public.payments (booking_id, gateway, gateway_reference, amount, raw_payload)
  values (b.id, p_gateway, p_reference, p_amount, p_payload);
  update public.bookings set status = 'confirmed', payment_status = 'held', gateway = p_gateway
   where id = b.id returning * into b;
  perform public.post_system_message(b.id, 'Booking paid. Your payment is held securely until delivery. Contact details unlocked.');
  return b;
end $$;

-- Photographer marks the final gallery as delivered.
create function public.deliver_gallery(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_need int; v_have int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.photographer_id is distinct from public.my_photographer_id() then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status not in ('confirmed', 'in_progress') then raise exception 'booking is not in a deliverable state (%)', b.status; end if;
  if now() < b.shoot_starts_at then raise exception 'the shoot has not happened yet'; end if;
  -- Delivery is verified: all of the package's edited photos must be on the platform (previews/proofs don't count).
  select num_photos into v_need from public.packages where id = b.package_id;
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

create function public.approve_gallery(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.client_id is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status <> 'gallery_uploaded' then raise exception 'no gallery awaiting approval'; end if;
  update public.bookings set gallery_approved_at = now() where id = b.id;
  perform public.post_system_message(b.id, 'Gallery approved.');
  perform public.process_booking_payouts(b.id);
  select * into b from public.bookings where id = p_booking;
  return b;
end $$;

---------------------------------------------------------------------------
-- Payout engine. Idempotent; safe to call repeatedly (cron + after events).
--   Deposit : 30% / 40% / 50% of the net amount (Tier 1 / 2 / 3), 24h after the shoot ends
--   Final   : the remainder, once the gallery is delivered AND (client approves OR the review window passes)
--   Fees are deducted from the booking total, so the photographer bears them across both payouts.
--   Never while disputed. Never to an unverified photographer (FICA).
---------------------------------------------------------------------------
create function public.process_booking_payouts(p_booking uuid) returns void
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
  v_net := b.total_amount - b.platform_fee - b.transaction_fee;

  if b.deposit_released_at is null and b.no_show_reported_at is null
     and now() >= b.shoot_ends_at + make_interval(hours => s.post_shoot_release_hours) then
    insert into public.payouts (photographer_id, booking_id, amount, type)
    values (b.photographer_id, b.id, b.deposit_amount, 'deposit_release');
    update public.bookings
       set deposit_released_at = now(), payment_status = 'partially_released',
           status = case when status = 'confirmed' then 'in_progress' else status end
     where id = b.id returning * into b;
    perform public.post_system_message(b.id, 'Shoot complete. The first part of the payment has been released to your photographer.');
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

-- Cron entry point (every ~15 minutes). Returns number of payouts created.
create function public.process_due_payouts() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_before int; v_after int;
begin
  select count(*) into v_before from public.payouts;
  for r in select id from public.bookings
            where status in ('confirmed', 'in_progress', 'gallery_uploaded')
              and payment_status in ('held', 'partially_released') loop
    perform public.process_booking_payouts(r.id);
  end loop;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'payment not received'
   where status = 'pending' and created_at < now() - interval '24 hours';
  select count(*) into v_after from public.payouts;
  return v_after - v_before;
end $$;

---------------------------------------------------------------------------
-- Cancellation policy
--   Client, >= 48h before : refund total minus platform fee
--   Client, <  48h before : payment forfeited to photographer (net of fees)
--   Photographer          : full refund, photographer gets a strike (suspended at N strikes)
---------------------------------------------------------------------------
create function public.cancel_booking(p_booking uuid, p_reason text default '') returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; s public.platform_settings; v_is_client boolean; v_is_photog boolean; v_strikes int;
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

  if b.status = 'pending' then
    update public.bookings set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
     where id = b.id returning * into b;
    return b;
  end if;

  if v_is_photog then
    update public.bookings set status = 'cancelled', payment_status = 'refunded', refund_amount = b.total_amount,
           cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
     where id = b.id returning * into b;
    update public.photographer_profiles set strike_count = strike_count + 1 where id = b.photographer_id
      returning strike_count into v_strikes;
    if v_strikes >= s.suspend_after_strikes then
      update public.photographer_profiles set verification_status = 'suspended' where id = b.photographer_id;
    end if;
    perform public.post_system_message(b.id, 'Your photographer cancelled. You will receive a full refund.');
  elsif b.shoot_starts_at - now() >= make_interval(hours => s.free_cancel_hours) then
    update public.bookings set status = 'cancelled', payment_status = 'refunded', refund_amount = b.total_amount - b.platform_fee,
           cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
     where id = b.id returning * into b;
    perform public.post_system_message(b.id, 'Booking cancelled. Your refund is on its way (platform fee excluded).');
  else
    insert into public.payouts (photographer_id, booking_id, amount, type)
    values (b.photographer_id, b.id, b.total_amount - b.platform_fee - b.transaction_fee, 'deposit_release');
    update public.bookings set status = 'cancelled', payment_status = 'fully_released', final_released_at = now(),
           cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
     where id = b.id returning * into b;
    perform public.post_system_message(b.id, 'Late cancellation: payment goes to the photographer under the cancellation policy.');
  end if;
  return b;
end $$;

---------------------------------------------------------------------------
-- Disputes
---------------------------------------------------------------------------
create function public.report_issue(p_booking uuid, p_type public.dispute_type, p_description text default '')
returns public.disputes
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; d public.disputes; v_is_client boolean; v_is_photog boolean;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'booking not found'; end if;
  v_is_client := coalesce(b.client_id = auth.uid(), false);
  v_is_photog := coalesce(b.photographer_id = public.my_photographer_id(), false);
  if not (v_is_client or v_is_photog) then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status not in ('confirmed', 'in_progress', 'gallery_uploaded') then raise exception 'cannot report an issue at this stage'; end if;

  if p_type in ('photographer_no_show', 'not_delivered', 'poor_quality') and not v_is_client then
    raise exception 'only the client can report this'; end if;
  if p_type = 'client_no_show' and not v_is_photog then raise exception 'only the photographer can report this'; end if;
  if p_type in ('photographer_no_show', 'client_no_show', 'not_delivered') and now() < b.shoot_starts_at then
    raise exception 'the shoot has not started yet'; end if;

  update public.bookings
     set status_before_dispute = b.status, status = 'disputed',
         no_show_reported_at = case when p_type in ('photographer_no_show', 'client_no_show') then now() else no_show_reported_at end
   where id = b.id;
  insert into public.disputes (booking_id, raised_by, type, description)
  values (b.id, auth.uid(), p_type, coalesce(p_description, '')) returning * into d;
  perform public.post_system_message(b.id, 'An issue was reported. Payment is frozen while our team reviews this booking.');
  return d;
end $$;

-- p_outcome: 'refund_client' | 'pay_photographer' | 'dismiss'
create function public.admin_resolve_dispute(p_dispute uuid, p_outcome text, p_note text default '')
returns public.disputes
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.disputes; b public.bookings; v_released numeric; v_amt numeric;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into d from public.disputes where id = p_dispute for update;
  if not found then raise exception 'dispute not found'; end if;
  if d.status in ('resolved_client', 'resolved_photographer', 'closed') then raise exception 'dispute already resolved'; end if;
  select * into b from public.bookings where id = d.booking_id for update;

  if p_outcome = 'refund_client' then
    update public.payouts set status = 'failed' where booking_id = b.id and status = 'pending';   -- cancel unsent payouts
    select coalesce(sum(amount), 0) into v_released from public.payouts where booking_id = b.id and status <> 'failed';
    update public.bookings set status = 'cancelled', payment_status = 'refunded', refund_amount = b.total_amount - v_released,
           cancelled_at = now(), cancellation_reason = 'dispute resolved in favour of client' where id = b.id;
    if d.type = 'photographer_no_show' then
      update public.photographer_profiles set verification_status = 'suspended', strike_count = strike_count + 1 where id = b.photographer_id;
    end if;
    update public.disputes set status = 'resolved_client' where id = d.id;
  elsif p_outcome = 'pay_photographer' then
    select coalesce(sum(amount), 0) into v_released from public.payouts where booking_id = b.id and status <> 'failed';
    v_amt := b.total_amount - b.platform_fee - b.transaction_fee - v_released;
    if v_amt > 0 then
      insert into public.payouts (photographer_id, booking_id, amount, type) values (b.photographer_id, b.id, v_amt, 'final_release');
    end if;
    update public.bookings set status = 'completed', payment_status = 'fully_released', final_released_at = now() where id = b.id;
    update public.disputes set status = 'resolved_photographer' where id = d.id;
  elsif p_outcome = 'dismiss' then
    update public.bookings set status = coalesce(status_before_dispute, 'confirmed'), status_before_dispute = null, no_show_reported_at = null
     where id = b.id;
    update public.disputes set status = 'closed' where id = d.id;
  else
    raise exception 'unknown outcome %', p_outcome;
  end if;

  -- A dispute must not eat the client's download window: guarantee at least 7 days after resolution.
  update public.bookings set gallery_expires_at = greatest(gallery_expires_at, now() + interval '7 days')
   where id = b.id and gallery_expires_at is not null and gallery_purged_at is null;
  update public.disputes set resolution = p_note, resolved_by = auth.uid(), resolved_at = now() where id = d.id returning * into d;
  perform public.post_system_message(b.id, 'Your issue has been reviewed and resolved by SnapshotZA.');
  return d;
end $$;

---------------------------------------------------------------------------
-- Reviews
---------------------------------------------------------------------------
create function public.submit_review(p_booking uuid, p_rating int, p_comment text default '') returns public.reviews
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; r public.reviews;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or b.client_id is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status <> 'completed' then raise exception 'you can review once the booking is complete'; end if;
  insert into public.reviews (booking_id, client_id, photographer_id, rating, comment)
  values (b.id, b.client_id, b.photographer_id, p_rating, coalesce(p_comment, '')) returning * into r;
  perform public.refresh_photographer_stats(b.photographer_id);
  return r;
end $$;

---------------------------------------------------------------------------
-- Photographer onboarding & admin verification
---------------------------------------------------------------------------
create function public.submit_for_verification() returns public.photographer_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare pp public.photographer_profiles; s public.platform_settings; v_name text; v_n int;
begin
  select * into pp from public.photographer_profiles where user_id = auth.uid() for update;
  if not found then raise exception 'not a photographer account'; end if;
  if pp.verification_status not in ('incomplete', 'rejected') then raise exception 'already submitted (%)', pp.verification_status; end if;
  select * into s from public.platform_settings;
  select full_name into v_name from public.profiles where id = auth.uid();

  if coalesce(trim(v_name), '') = '' or trim(pp.bio) = '' or trim(pp.location) = '' then
    raise exception 'complete your profile: name, bio and location'; end if;
  select count(*) into v_n from public.photos where photographer_id = pp.id and is_portfolio;
  if v_n < s.onboarding_min_photos then raise exception 'add at least % portfolio photos (you have %)', s.onboarding_min_photos, v_n; end if;
  select count(*) into v_n from public.packages where photographer_id = pp.id and is_active;
  if v_n < s.onboarding_min_packages then raise exception 'create at least % packages', s.onboarding_min_packages; end if;
  if not exists (select 1 from public.payout_accounts where photographer_id = pp.id) then raise exception 'add your bank details'; end if;
  if not (
       (exists (select 1 from public.verification_documents where photographer_id = pp.id and doc_type = 'sa_id_front')
        and exists (select 1 from public.verification_documents where photographer_id = pp.id and doc_type = 'sa_id_back'))
    or exists (select 1 from public.verification_documents where photographer_id = pp.id and doc_type = 'passport')
  ) then raise exception 'upload your ID (front and back) or passport'; end if;
  if not exists (select 1 from public.verification_documents where photographer_id = pp.id and doc_type = 'selfie') then
    raise exception 'take your selfie check'; end if;
  if pp.terms_accepted_at is null then raise exception 'accept the terms to continue'; end if;

  update public.photographer_profiles set verification_status = 'pending_verification', verification_note = null
   where id = pp.id returning * into pp;
  return pp;
end $$;

create function public.admin_review_photographer(p_photographer uuid, p_approve boolean, p_note text default '')
returns public.photographer_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare pp public.photographer_profiles; s public.platform_settings;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into s from public.platform_settings;
  if p_approve then
    update public.photographer_profiles
       set id_verified = true, bank_verified = true, verification_status = 'approved', verification_note = null
     where id = p_photographer returning * into pp;
    update public.payout_accounts set verified_at = now() where photographer_id = p_photographer;
    update public.verification_documents set delete_after = now() + make_interval(days => s.doc_retention_days)
     where photographer_id = p_photographer;
  else
    update public.photographer_profiles
       set verification_status = 'rejected', verification_note = nullif(p_note, '')
     where id = p_photographer returning * into pp;
  end if;
  if not found then raise exception 'photographer not found'; end if;
  return pp;
end $$;

-- Re-verify bank details after a photographer changed them.
create function public.admin_verify_bank(p_photographer uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.payout_accounts set verified_at = now() where photographer_id = p_photographer;
  update public.photographer_profiles set bank_verified = true where id = p_photographer;
end $$;

-- Mark a payout as sent (after the manual EFT / Stitch call).
create function public.admin_complete_payout(p_payout uuid, p_bank_reference text) returns public.payouts
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.payouts;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.payouts set status = 'completed', bank_reference = p_bank_reference, completed_at = now()
   where id = p_payout and status in ('pending', 'processing') returning * into p;
  if not found then raise exception 'payout not found or already finished'; end if;
  return p;
end $$;

---------------------------------------------------------------------------
-- Public availability (open days minus booked days) for the calendar screen
---------------------------------------------------------------------------
create function public.get_availability(p_photographer uuid, p_from date, p_to date)
returns table (day date, is_booked boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.day,
         exists (select 1 from public.bookings b
                  where b.photographer_id = a.photographer_id and b.shoot_date = a.day
                    and (b.status in ('confirmed', 'in_progress', 'gallery_uploaded', 'disputed')
                         or (b.status = 'pending' and b.created_at > now() - interval '30 minutes'))) as is_booked
    from public.availability a
    join public.photographer_profiles pp on pp.id = a.photographer_id and pp.verification_status = 'approved'
   where a.photographer_id = p_photographer and a.is_open and a.day between p_from and p_to
   order by a.day;
$$;

---------------------------------------------------------------------------
-- Gallery retention. Final (full-res) files live for gallery_retention_days after delivery, then are deleted.
-- Watermarked proofs / previews are kept. Disputed bookings are never purged.
-- These are called by Edge Functions / jobs using the service role.
---------------------------------------------------------------------------
-- Is this user allowed to download the final photos right now? (The signed-URL function calls this.)
create function public.can_download_gallery(p_booking uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.bookings b
     where b.id = p_booking and b.client_id = p_user
       and b.status = 'completed'                      -- payment released = downloads unlocked
       and b.gallery_uploaded_at is not null and b.gallery_purged_at is null
       and now() < b.gallery_expires_at);
$$;

-- Galleries whose files must be deleted from storage now.
create function public.list_expired_galleries() returns table (booking_id uuid, storage_paths text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, coalesce(array_agg(p.storage_path) filter (where p.storage_path is not null), '{}')
    from public.bookings b
    left join public.photos p on p.booking_id = b.id and not p.is_proof
   where b.gallery_uploaded_at is not null and b.gallery_purged_at is null
     and b.gallery_expires_at <= now() and b.status <> 'disputed'
   group by b.id;
$$;

-- Call after the storage objects have been deleted. Removes the final-photo rows, keeps proofs.
create function public.mark_gallery_purged(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'booking not found'; end if;
  if b.gallery_purged_at is not null then return; end if;                    -- idempotent
  if b.status = 'disputed' then raise exception 'gallery is under dispute'; end if;
  if b.gallery_expires_at is null or b.gallery_expires_at > now() then raise exception 'gallery has not expired'; end if;
  delete from public.photos where booking_id = b.id and not is_proof;
  update public.bookings set gallery_purged_at = now() where id = b.id;
  perform public.post_system_message(b.id, 'Your photos have been deleted from SnapshotZA after the download period. Ask your photographer if you need a copy.');
end $$;

-- For the reminder job (email / push): clients with downloads about to expire.
create function public.list_expiring_galleries(p_within_days int)
returns table (booking_id uuid, client_id uuid, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.client_id, b.gallery_expires_at
    from public.bookings b
   where b.status = 'completed' and b.gallery_purged_at is null
     and b.gallery_expires_at > now() and b.gallery_expires_at <= now() + make_interval(days => p_within_days);
$$;

---------------------------------------------------------------------------
-- Function privileges. Supabase grants EXECUTE to anon/authenticated by default,
-- so anything that must not be callable from the app is revoked explicitly.
---------------------------------------------------------------------------
revoke execute on function
  public.confirm_payment(uuid, public.pay_gateway, text, numeric, jsonb),
  public.process_booking_payouts(uuid),
  public.process_due_payouts(),
  public.refresh_photographer_stats(uuid),
  public.post_system_message(uuid, text),
  public.can_download_gallery(uuid, uuid),
  public.list_expired_galleries(),
  public.mark_gallery_purged(uuid),
  public.list_expiring_galleries(int)
from public, anon, authenticated;
grant execute on function public.can_download_gallery(uuid, uuid), public.list_expired_galleries(),
  public.mark_gallery_purged(uuid), public.list_expiring_galleries(int) to service_role;
grant execute on function public.confirm_payment(uuid, public.pay_gateway, text, numeric, jsonb) to service_role;
grant execute on function public.process_due_payouts() to service_role;

-- Everything an app user may call requires a signed-in user.
revoke execute on function
  public.create_booking(uuid, date, time, text, public.pay_gateway),
  public.deliver_gallery(uuid), public.approve_gallery(uuid), public.cancel_booking(uuid, text),
  public.report_issue(uuid, public.dispute_type, text), public.submit_review(uuid, int, text),
  public.submit_for_verification(),
  public.admin_resolve_dispute(uuid, text, text), public.admin_review_photographer(uuid, boolean, text),
  public.admin_verify_bank(uuid), public.admin_complete_payout(uuid, text)
from public, anon;
grant execute on function
  public.create_booking(uuid, date, time, text, public.pay_gateway),
  public.deliver_gallery(uuid), public.approve_gallery(uuid), public.cancel_booking(uuid, text),
  public.report_issue(uuid, public.dispute_type, text), public.submit_review(uuid, int, text),
  public.submit_for_verification(),
  public.admin_resolve_dispute(uuid, text, text), public.admin_review_photographer(uuid, boolean, text),
  public.admin_verify_bank(uuid), public.admin_complete_payout(uuid, text)
to authenticated;
