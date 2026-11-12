-- SnapshotZA · 0009 · Shoot confirmation, in-app notifications, and problem reports
--
-- 1. The first payment is no longer released just because time passed. The photographer marks the shoot complete
--    (never before it has started). The client confirms it - or, after 24 hours of silence, it is confirmed automatically.
-- 2. In-app notifications for the events that matter (payment queued / being sent / sent, new booking, problems...).
-- 3. Problem reports freeze any payment that has not been withdrawn yet, until an admin decides.
--
-- Safe to run once, after 0008.

---------------------------------------------------------------------------
-- Columns
---------------------------------------------------------------------------
alter table public.bookings
  add column shoot_completed_at timestamptz,   -- photographer says the shoot is done (starts the client's 24h window)
  add column shoot_confirmed_at timestamptz;   -- client confirmed the shoot happened
alter table public.payouts
  add column frozen boolean not null default false;  -- a payout on hold because of a problem report

-- Bookings that already progressed under the old rule keep a consistent history.
update public.bookings set shoot_completed_at = shoot_ends_at
 where shoot_completed_at is null and status in ('in_progress', 'gallery_uploaded', 'completed');

---------------------------------------------------------------------------
-- Notifications
---------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null default '',
  booking_id uuid references public.bookings (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index on public.notifications (user_id, created_at desc);
create index on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- People can read their own and mark them read - nothing else. Notifications are created only by the functions below.
revoke all on public.notifications from anon;
revoke insert, delete, truncate on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Rand amounts as text: R2,400.00
create function public.zar(p numeric) returns text language sql immutable as $$
  select 'R' || trim(to_char(p, 'FM999,999,990.00'));
$$;

create function public.notify(p_user uuid, p_type text, p_title text, p_body text default '', p_booking uuid default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, type, title, body, booking_id)
  select p_user, p_type, p_title, p_body, p_booking where p_user is not null;
$$;

create function public.notify_admins(p_type text, p_title text, p_body text, p_booking uuid default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, type, title, body, booking_id)
  select id, p_type, p_title, p_body, p_booking from public.profiles where role = 'admin';
$$;

-- A booking whose payment was a test payment gets "(test)" on its notifications.
create function public.booking_is_test(p_booking uuid) returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (select 1 from public.payments where booking_id = p_booking and raw_payload ->> 'simulated' = 'true')
      or exists (select 1 from public.bookings where id = p_booking and simulated);
$$;

---------------------------------------------------------------------------
-- Notifications raised by booking / payout state changes (covers every code path: app, cron, admin)
---------------------------------------------------------------------------
-- A photographer who delivers photos has obviously done the shoot: start the client's confirmation window.
create function public.bookings_set_completed() returns trigger language plpgsql as $$
begin
  if new.status = 'gallery_uploaded' and old.status is distinct from 'gallery_uploaded' and new.shoot_completed_at is null then
    new.shoot_completed_at := now();
  end if;
  return new;
end $$;
create trigger bookings_set_completed before update of status on public.bookings
  for each row execute function public.bookings_set_completed();

create function public.bookings_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pu uuid; v_pname text; v_cname text; v_when text; v_test text; v_hours int;
begin
  select user_id into v_pu from public.photographer_profiles where id = new.photographer_id;
  select full_name into v_pname from public.profiles where id = v_pu;
  select full_name into v_cname from public.profiles where id = new.client_id;
  v_when := to_char(new.shoot_starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon "at" HH24:MI');
  v_test := case when public.booking_is_test(new.id) then ' (Test booking.)' else '' end;
  select review_window_hours into v_hours from public.platform_settings;

  if old.status = 'pending' and new.status = 'confirmed' then
    perform public.notify(v_pu, 'new_booking', 'New booking',
      format('%s booked you for %s. %s is held securely until the shoot.%s', split_part(coalesce(v_cname, 'A client'), ' ', 1), v_when, public.zar(new.total_amount), v_test), new.id);
    perform public.notify(new.client_id, 'booking_confirmed', 'Booking confirmed',
      format('Your shoot with %s is confirmed for %s. Your payment is held securely.%s', coalesce(v_pname, 'your photographer'), v_when, v_test), new.id);

  elsif new.status = 'gallery_uploaded' and old.status is distinct from 'gallery_uploaded' then
    perform public.notify(new.client_id, 'gallery_ready', 'Your photos are ready',
      format('%s has delivered your photos. Approve them to release the rest of the payment, or it is released automatically in %s hours.', coalesce(v_pname, 'Your photographer'), v_hours), new.id);

  elsif new.status = 'completed' and old.status = 'gallery_uploaded' then
    perform public.notify(new.client_id, 'review_prompt', 'How was your shoot?',
      format('Your booking with %s is complete. Tell others what it was like.', coalesce(v_pname, 'your photographer')), new.id);

  elsif new.status = 'cancelled' and old.status = 'confirmed' and new.cancelled_by is not null then
    if new.cancelled_by = new.client_id then
      perform public.notify(v_pu, 'booking_cancelled', 'Booking cancelled',
        format('%s cancelled the shoot on %s.%s', split_part(coalesce(v_cname, 'The client'), ' ', 1), v_when, v_test), new.id);
    else
      perform public.notify(new.client_id, 'booking_cancelled', 'Booking cancelled',
        format('%s cancelled your shoot on %s. You will be refunded in full.%s', coalesce(v_pname, 'Your photographer'), v_when, v_test), new.id);
    end if;
  end if;

  -- Released automatically because the client did not respond within the window.
  if new.deposit_released_at is not null and old.deposit_released_at is null and new.shoot_confirmed_at is null then
    perform public.notify(new.client_id, 'shoot_autoconfirmed', 'Your shoot was confirmed automatically',
      format('We did not hear from you within 24 hours, so the first payment was released to %s.', coalesce(v_pname, 'your photographer')), new.id);
  end if;
  return null;
end $$;
create trigger bookings_notify after update on public.bookings
  for each row execute function public.bookings_notify();

-- Money that becomes available to the photographer: "queued" in their words.
create function public.payouts_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pu uuid; v_ref text; v_status public.booking_status; v_title text;
begin
  select user_id into v_pu from public.photographer_profiles where id = new.photographer_id;
  select booking_ref, status into v_ref, v_status from public.bookings where id = new.booking_id;
  v_title := case when v_status = 'cancelled' then 'Payment ready to withdraw'
                  when new.type = 'deposit_release' then 'First payment ready'
                  else 'Final payment ready' end;
  perform public.notify(v_pu, 'payout_queued', v_title,
    format('%s from booking %s has been released to you and is ready to withdraw.%s', public.zar(new.amount), v_ref,
           case when new.simulated then ' (Test payment.)' else '' end), new.booking_id);
  return null;
end $$;
create trigger payouts_notify after insert on public.payouts
  for each row execute function public.payouts_notify();

---------------------------------------------------------------------------
-- Shoot confirmation
---------------------------------------------------------------------------
-- Photographer: "the shoot is done". Not before the shoot has started.
create function public.mark_shoot_complete(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_pname text; v_hours int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.photographer_id is distinct from public.my_photographer_id() then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if b.shoot_completed_at is not null then return b; end if;                       -- already marked: nothing to do
  if b.status <> 'confirmed' then raise exception 'this booking is not waiting for its shoot'; end if;
  if now() < b.shoot_starts_at then
    raise exception 'you can mark the shoot complete once it has started (%)',
      to_char(b.shoot_starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon "at" HH24:MI');
  end if;

  update public.bookings set shoot_completed_at = now() where id = b.id returning * into b;
  select full_name into v_pname from public.profiles where id = auth.uid();
  select post_shoot_release_hours into v_hours from public.platform_settings;
  perform public.post_system_message(b.id, format('%s says the shoot is complete. Please confirm it, or report a problem.', split_part(coalesce(v_pname, 'Your photographer'), ' ', 1)));
  perform public.notify(b.client_id, 'confirm_shoot', 'Did your shoot happen?',
    format('%s says your shoot is complete. Confirm it to release their first payment, or report a problem. If we do not hear from you within %s hours it is confirmed automatically.',
           split_part(coalesce(v_pname, 'Your photographer'), ' ', 1), v_hours), b.id);
  return b;
end $$;

-- Client: "yes, the shoot happened". Releases the first payment straight away.
create function public.confirm_shoot(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.client_id is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.shoot_confirmed_at is not null then return b; end if;                       -- already confirmed
  if b.status <> 'confirmed' then raise exception 'this booking is not waiting for a shoot confirmation'; end if;
  if now() < b.shoot_starts_at then raise exception 'you can confirm the shoot once it has started'; end if;

  update public.bookings
     set shoot_confirmed_at = now(), shoot_completed_at = coalesce(shoot_completed_at, now())
   where id = b.id;
  perform public.post_system_message(b.id, 'Shoot confirmed by the client.');
  perform public.process_booking_payouts(b.id);
  select * into b from public.bookings where id = p_booking;
  return b;
end $$;

-- The release engine. The first payment is due once the client has confirmed the shoot, or the photographer marked it
-- complete and the client has not responded within post_shoot_release_hours. Never while a problem is open.
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
  v_net := b.total_amount - b.platform_fee - b.transaction_fee;

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

---------------------------------------------------------------------------
-- Problem reports
---------------------------------------------------------------------------
create or replace function public.report_issue(p_booking uuid, p_type public.dispute_type, p_description text default '')
returns public.disputes
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.bookings; d public.disputes; v_is_client boolean; v_is_photog boolean;
  v_pu uuid; v_who text; v_label text; v_other uuid;
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
  if length(trim(coalesce(p_description, ''))) < 10 then
    raise exception 'please describe what happened (at least 10 characters)'; end if;

  update public.bookings
     set status_before_dispute = b.status, status = 'disputed',
         no_show_reported_at = case when p_type in ('photographer_no_show', 'client_no_show') then now() else no_show_reported_at end
   where id = b.id;
  -- Anything released but not yet withdrawn is put on hold until an admin decides.
  update public.payouts set frozen = true where booking_id = b.id and status = 'pending';
  insert into public.disputes (booking_id, raised_by, type, description)
  values (b.id, auth.uid(), p_type, trim(p_description)) returning * into d;

  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  select full_name into v_who from public.profiles where id = auth.uid();
  v_other := case when v_is_client then v_pu else b.client_id end;
  v_label := case p_type when 'photographer_no_show' then 'the photographer did not show up'
                         when 'client_no_show' then 'the client did not show up'
                         when 'not_delivered' then 'the photos were not delivered'
                         when 'poor_quality' then 'the photos are not what was agreed'
                         else 'a problem' end;
  perform public.post_system_message(b.id, 'A problem was reported. Payments on this booking are on hold while our team reviews it.');
  perform public.notify(auth.uid(), 'issue_received', 'We received your report',
    'Our team will review it and get back to you. Payments on this booking are on hold.', b.id);
  perform public.notify(v_other, 'issue_reported', 'A problem was reported on your booking',
    format('Booking %s: %s reported that %s. Payments are on hold while our team reviews it.', b.booking_ref, coalesce(v_who, 'the other person'), v_label), b.id);
  perform public.notify_admins('dispute_opened', 'New report to review',
    format('%s reported that %s (booking %s).', coalesce(v_who, 'A user'), v_label, b.booking_ref), b.id);
  return d;
end $$;

-- p_outcome: 'refund_client' | 'pay_photographer' | 'dismiss'
create or replace function public.admin_resolve_dispute(p_dispute uuid, p_outcome text, p_note text default '')
returns public.disputes
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.disputes; b public.bookings; v_released numeric; v_amt numeric; v_pu uuid; v_note text;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into d from public.disputes where id = p_dispute for update;
  if not found then raise exception 'dispute not found'; end if;
  if d.status in ('resolved_client', 'resolved_photographer', 'closed') then raise exception 'dispute already resolved'; end if;
  select * into b from public.bookings where id = d.booking_id for update;
  select user_id into v_pu from public.photographer_profiles where id = b.photographer_id;
  v_note := case when length(trim(coalesce(p_note, ''))) > 0 then ' Note from our team: ' || trim(p_note) else '' end;

  if p_outcome = 'refund_client' then
    update public.payouts set status = 'failed' where booking_id = b.id and status = 'pending';   -- cancel unsent payouts
    select coalesce(sum(amount), 0) into v_released from public.payouts where booking_id = b.id and status <> 'failed';
    update public.bookings set status = 'cancelled', payment_status = 'refunded', refund_amount = b.total_amount - v_released,
           cancelled_at = now(), cancellation_reason = 'dispute resolved in favour of client' where id = b.id;
    if d.type = 'photographer_no_show' then
      update public.photographer_profiles set verification_status = 'suspended', strike_count = strike_count + 1 where id = b.photographer_id;
    end if;
    update public.disputes set status = 'resolved_client' where id = d.id;
    perform public.notify(b.client_id, 'issue_resolved', 'Your report was upheld',
      format('Booking %s was cancelled and you are being refunded %s.%s', b.booking_ref, public.zar(b.total_amount - v_released), v_note), b.id);
    perform public.notify(v_pu, 'issue_resolved', 'Report decided',
      format('After review, booking %s was cancelled and the client was refunded.%s', b.booking_ref, v_note), b.id);
  elsif p_outcome = 'pay_photographer' then
    select coalesce(sum(amount), 0) into v_released from public.payouts where booking_id = b.id and status <> 'failed';
    v_amt := b.total_amount - b.platform_fee - b.transaction_fee - v_released;
    update public.payouts set frozen = false where booking_id = b.id;
    if v_amt > 0 then
      insert into public.payouts (photographer_id, booking_id, amount, type) values (b.photographer_id, b.id, v_amt, 'final_release');
    end if;
    update public.bookings set status = 'completed', payment_status = 'fully_released', final_released_at = now() where id = b.id;
    update public.disputes set status = 'resolved_photographer' where id = d.id;
    perform public.notify(v_pu, 'issue_resolved', 'Report decided in your favour',
      format('The payment for booking %s has been released to you.%s', b.booking_ref, v_note), b.id);
    perform public.notify(b.client_id, 'issue_resolved', 'Your report was reviewed',
      format('After review, booking %s was completed as delivered.%s', b.booking_ref, v_note), b.id);
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

---------------------------------------------------------------------------
-- Withdrawals: held payouts are not withdrawable; the photographer is told what is happening to their money
---------------------------------------------------------------------------
create or replace function public.request_withdrawal() returns table (r_total numeric, r_count int, r_reference text, r_completed boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pid uuid := public.my_photographer_id(); pp public.photographer_profiles; v_acct public.payout_accounts;
  v_total numeric; v_n int; v_sim int; v_sim_total numeric; v_real_total numeric; v_ref text; v_test boolean;
begin
  if v_pid is null then raise exception 'not a photographer account'; end if;
  select * into pp from public.photographer_profiles where id = v_pid;
  if not (pp.verification_status = 'approved' and pp.id_verified and pp.bank_verified) then
    raise exception 'add and verify your bank details before withdrawing'; end if;
  select * into v_acct from public.payout_accounts where photographer_id = v_pid;
  v_test := (select simulate_payments from public.platform_settings);

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

create or replace function public.admin_complete_payout(p_payout uuid, p_bank_reference text) returns public.payouts
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.payouts; v_pu uuid; v_acct public.payout_accounts;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.payouts set status = 'completed', bank_reference = p_bank_reference, completed_at = now()
   where id = p_payout and status in ('pending', 'processing') and not frozen returning * into p;
  if not found then raise exception 'payout not found, on hold, or already finished'; end if;
  select user_id into v_pu from public.photographer_profiles where id = p.photographer_id;
  select * into v_acct from public.payout_accounts where photographer_id = p.photographer_id;
  perform public.notify(v_pu, 'payout_sent', 'Money sent',
    format('%s was sent to your %s account ending %s (reference %s).', public.zar(p.amount), v_acct.bank_name, v_acct.account_last4, p_bank_reference), p.booking_id);
  return p;
end $$;

-- my_earnings gains "on hold" (so it needs to be recreated).
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
-- TEST MODE helpers (reworked for the new flow)
---------------------------------------------------------------------------
drop function public.simulate_shoot_done(uuid);

-- "Jump to after the shoot": moves the shoot into the past so the real "mark complete" / "confirm" steps work.
create function public.simulate_shoot_over(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_len interval;
begin
  if not (select simulate_payments from public.platform_settings) then raise exception 'test mode is switched off'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if not found or not (public.is_booking_party(p_booking) or public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not b.simulated then raise exception 'only test bookings can be fast-forwarded'; end if;
  if b.status <> 'confirmed' then raise exception 'this booking is not waiting for its shoot'; end if;
  if b.shoot_starts_at <= now() then return b; end if;                      -- already started: nothing to do
  v_len := b.shoot_ends_at - b.shoot_starts_at;
  update public.bookings
     set shoot_ends_at = now() - interval '2 hours', shoot_starts_at = now() - interval '2 hours' - v_len
   where id = b.id returning * into b;
  return b;
end $$;

-- "Skip the wait": jumps over the client's 24h confirmation window, or the 48h photo review window.
create function public.simulate_skip_wait(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; s public.platform_settings;
begin
  if not (select simulate_payments from public.platform_settings) then raise exception 'test mode is switched off'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if not found or not (public.is_booking_party(p_booking) or public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not b.simulated then raise exception 'only test bookings can be fast-forwarded'; end if;
  select * into s from public.platform_settings;
  if b.status = 'confirmed' and b.shoot_completed_at is not null and b.deposit_released_at is null then
    update public.bookings set shoot_completed_at = now() - make_interval(hours => s.post_shoot_release_hours + 1) where id = b.id;
  elsif b.status = 'gallery_uploaded' and b.gallery_approved_at is null then
    update public.bookings set gallery_uploaded_at = now() - make_interval(hours => s.review_window_hours + 1) where id = b.id;
  else
    raise exception 'there is no waiting period to skip right now';
  end if;
  perform public.process_booking_payouts(b.id);
  select * into b from public.bookings where id = p_booking;
  return b;
end $$;

create or replace function public.simulate_delivery(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  if not (select simulate_payments from public.platform_settings) then raise exception 'test mode is switched off'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if not found or not (coalesce(b.photographer_id = public.my_photographer_id(), false) or public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not b.simulated then raise exception 'only test bookings can be delivered without photos'; end if;
  if b.status not in ('confirmed', 'in_progress') then raise exception 'this booking is not ready for delivery'; end if;
  if b.shoot_starts_at > now() then raise exception 'jump to after the shoot first'; end if;
  update public.bookings
     set status = 'gallery_uploaded', gallery_uploaded_at = now(),
         gallery_expires_at = now() + make_interval(days => (select gallery_retention_days from public.platform_settings))
   where id = b.id;
  perform public.post_system_message(b.id, 'Your photos are ready to review. (Test delivery: no photos were uploaded.)');
  perform public.process_booking_payouts(b.id);
  select * into b from public.bookings where id = p_booking;
  return b;
end $$;

---------------------------------------------------------------------------
-- Privileges
---------------------------------------------------------------------------
revoke execute on function
  public.zar(numeric), public.notify(uuid, text, text, text, uuid), public.notify_admins(text, text, text, uuid),
  public.booking_is_test(uuid), public.bookings_set_completed(), public.bookings_notify(), public.payouts_notify()
from public, anon, authenticated;

revoke execute on function
  public.mark_shoot_complete(uuid), public.confirm_shoot(uuid),
  public.simulate_shoot_over(uuid), public.simulate_skip_wait(uuid), public.simulate_delivery(uuid),
  public.request_withdrawal(), public.my_earnings(), public.report_issue(uuid, public.dispute_type, text),
  public.admin_resolve_dispute(uuid, text, text), public.admin_complete_payout(uuid, text)
from public, anon;
grant execute on function
  public.mark_shoot_complete(uuid), public.confirm_shoot(uuid),
  public.simulate_shoot_over(uuid), public.simulate_skip_wait(uuid), public.simulate_delivery(uuid),
  public.request_withdrawal(), public.my_earnings(), public.report_issue(uuid, public.dispute_type, text),
  public.admin_resolve_dispute(uuid, text, text), public.admin_complete_payout(uuid, text)
to authenticated;
