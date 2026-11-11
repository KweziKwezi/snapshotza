-- SnapshotZA · 0007 · Marketplace listing: add a small cover thumbnail so the home grid does not download full-size photos.
-- Adds one column at the END of the view (required by CREATE OR REPLACE VIEW). Existing grants are kept.

create or replace view public.public_photographers as
select pp.id, pr.full_name, pr.profile_photo_url, pp.bio, pp.location, pp.service_radius_km, pp.specialties,
       pp.tier, pp.total_bookings, pp.average_rating, pp.review_count, pp.id_verified,
       pp.instagram_handle, pp.website_url,
       (select min(k.price_zar) from public.packages k where k.photographer_id = pp.id and k.is_active) as from_price,
       (select ph.url from public.photos ph where ph.photographer_id = pp.id and ph.is_portfolio and ph.is_cover limit 1) as cover_url,
       (select coalesce(ph.thumbnail_url, ph.url) from public.photos ph
         where ph.photographer_id = pp.id and ph.is_portfolio and ph.is_cover limit 1) as cover_thumb_url
  from public.photographer_profiles pp
  join public.profiles pr on pr.id = pp.user_id
 where pp.verification_status = 'approved';

grant select on public.public_photographers to anon, authenticated;
