-- SnapshotZA · 0006 · Fix: approved photographers' portfolio and packages were invisible to everyone but the owner.
--
-- The policies in 0003 decided "is this photographer approved?" with a sub-select on photographer_profiles.
-- That sub-select ran as the *viewer*, and photographer_profiles is (correctly) private, so for visitors and
-- clients it always came back empty and the portfolio/packages stayed hidden.
-- The check now goes through a SECURITY DEFINER helper that only answers yes/no.

create or replace function public.is_approved_photographer(p_photographer uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.photographer_profiles
     where id = p_photographer and verification_status = 'approved');
$$;

drop policy if exists packages_public on public.packages;
create policy packages_public on public.packages for select
  using (is_active and public.is_approved_photographer(photographer_id));

drop policy if exists photos_portfolio on public.photos;
create policy photos_portfolio on public.photos for select
  using (is_portfolio and public.is_approved_photographer(photographer_id));
