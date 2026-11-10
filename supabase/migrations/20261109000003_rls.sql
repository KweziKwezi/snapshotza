-- SnapshotZA · 0003 · Row Level Security
-- Principle: deny by default. Money, booking state, tiers and verification are never writable
-- directly by the app; they change only through the functions in 0002 (or the service role).

alter table public.platform_settings      enable row level security;
alter table public.profiles               enable row level security;
alter table public.photographer_profiles  enable row level security;
alter table public.payout_accounts        enable row level security;
alter table public.verification_documents enable row level security;
alter table public.packages               enable row level security;
alter table public.availability           enable row level security;
alter table public.bookings               enable row level security;
alter table public.payments               enable row level security;
alter table public.payouts                enable row level security;
alter table public.chat_messages          enable row level security;
alter table public.photos                 enable row level security;
alter table public.reviews                enable row level security;
alter table public.favorites              enable row level security;
alter table public.disputes               enable row level security;

-- Defence in depth: even if a permissive policy is added by mistake later, the app roles cannot write
-- these tables. They change only through the SECURITY DEFINER functions in 0002.
revoke insert, update, delete, truncate on public.bookings, public.payments, public.payouts,
                                           public.reviews, public.disputes from anon, authenticated;
revoke insert, delete, truncate on public.profiles, public.photographer_profiles from anon, authenticated;
revoke insert, delete, truncate on public.platform_settings from anon, authenticated;
revoke all on public.payout_accounts, public.verification_documents, public.payments, public.payouts from anon;

-- platform_settings: fees are transparent; only admins change them.
create policy settings_read  on public.platform_settings for select using (true);
create policy settings_admin on public.platform_settings for update using (public.is_admin()) with check (public.is_admin());

-- profiles: yourself, admins, or the other party of a paid booking (contact unlock).
-- Role changes are blocked by the guard trigger.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.can_see_contact(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- photographer_profiles: owner, admin, or a client who has booked them.
-- Everyone else browses through the public_photographers view (no lat/long, no internals).
create policy pp_select on public.photographer_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.has_booking_with_photographer(id));
create policy pp_update on public.photographer_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- payout_accounts: owner + admin only. Never readable by clients or other photographers.
create policy payout_accounts_owner on public.payout_accounts for all to authenticated
  using (photographer_id = public.my_photographer_id()) with check (photographer_id = public.my_photographer_id());
create policy payout_accounts_admin on public.payout_accounts for select to authenticated using (public.is_admin());

-- verification_documents: owner can upload/see/remove their own; admin can read.
create policy vdocs_owner on public.verification_documents for all to authenticated
  using (photographer_id = public.my_photographer_id()) with check (photographer_id = public.my_photographer_id());
create policy vdocs_admin on public.verification_documents for select to authenticated using (public.is_admin());

-- packages: public when the photographer is approved; owner manages their own.
create policy packages_public on public.packages for select
  using (is_active and exists (select 1 from public.photographer_profiles pp
                                where pp.id = photographer_id and pp.verification_status = 'approved'));
create policy packages_owner on public.packages for all to authenticated
  using (photographer_id = public.my_photographer_id()) with check (photographer_id = public.my_photographer_id());
create policy packages_admin on public.packages for select to authenticated using (public.is_admin());

-- availability: owner edits; public reads go through get_availability().
create policy availability_owner on public.availability for all to authenticated
  using (photographer_id = public.my_photographer_id()) with check (photographer_id = public.my_photographer_id());

-- bookings: parties and admins can read. No direct writes.
create policy bookings_select on public.bookings for select to authenticated
  using (client_id = auth.uid() or photographer_id = public.my_photographer_id() or public.is_admin());

-- payments: the paying client and admins only (photographers never see gateway data).
create policy payments_select on public.payments for select to authenticated
  using (public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid()));

-- payouts: the photographer being paid, and admins.
create policy payouts_select on public.payouts for select to authenticated
  using (photographer_id = public.my_photographer_id() or public.is_admin());

-- chat: only the two parties (and admins for disputes). Chat opens once the booking is paid.
create policy chat_select on public.chat_messages for select to authenticated
  using (public.is_booking_party(booking_id) or public.is_admin());
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and message_type in ('text', 'image', 'proof')
    and public.is_booking_party(booking_id)
    and exists (select 1 from public.bookings b
                 where b.id = booking_id and b.payment_status <> 'pending' and b.status not in ('pending', 'cancelled'))
    and (message_type <> 'proof'
         or exists (select 1 from public.bookings b where b.id = booking_id and b.photographer_id = public.my_photographer_id()))
  );

-- photos: portfolio is public for approved photographers; booking photos only for the two parties.
create policy photos_portfolio on public.photos for select
  using (is_portfolio and exists (select 1 from public.photographer_profiles pp
                                   where pp.id = photographer_id and pp.verification_status = 'approved'));
create policy photos_party on public.photos for select to authenticated
  using (photographer_id = public.my_photographer_id()
         or (booking_id is not null and public.is_booking_party(booking_id))
         or public.is_admin());
create policy photos_owner_write on public.photos for insert to authenticated
  with check (photographer_id = public.my_photographer_id()
              and (booking_id is null or exists (select 1 from public.bookings b
                                                  where b.id = booking_id and b.photographer_id = public.my_photographer_id())));
create policy photos_owner_update on public.photos for update to authenticated
  using (photographer_id = public.my_photographer_id()) with check (photographer_id = public.my_photographer_id());
create policy photos_owner_delete on public.photos for delete to authenticated
  using (photographer_id = public.my_photographer_id());

-- reviews: public read; writes only via submit_review().
create policy reviews_read on public.reviews for select using (true);

-- favourites: your own list.
create policy favorites_own on public.favorites for all to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());

-- disputes: parties and admins read; creation/resolution via functions.
create policy disputes_select on public.disputes for select to authenticated
  using (public.is_booking_party(booking_id) or public.is_admin());

---------------------------------------------------------------------------
-- Public discovery view: approved photographers only, safe columns only.
-- (Runs with the view owner's rights, so it intentionally bypasses table RLS.)
---------------------------------------------------------------------------
create view public.public_photographers as
select pp.id, pr.full_name, pr.profile_photo_url, pp.bio, pp.location, pp.service_radius_km, pp.specialties,
       pp.tier, pp.total_bookings, pp.average_rating, pp.review_count, pp.id_verified,
       pp.instagram_handle, pp.website_url,
       (select min(k.price_zar) from public.packages k where k.photographer_id = pp.id and k.is_active) as from_price,
       (select ph.url from public.photos ph where ph.photographer_id = pp.id and ph.is_portfolio and ph.is_cover limit 1) as cover_url
  from public.photographer_profiles pp
  join public.profiles pr on pr.id = pp.user_id
 where pp.verification_status = 'approved';
grant select on public.public_photographers to anon, authenticated;

---------------------------------------------------------------------------
-- Realtime (chat + booking status)
---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages, public.bookings;
  end if;
end $$;
