-- SnapshotZA · 0001 · Schema
-- Money is always numeric(12,2) in ZAR. All timestamps are timestamptz.

---------------------------------------------------------------------------
-- Enums
---------------------------------------------------------------------------
create type public.user_role           as enum ('client', 'photographer', 'admin');
create type public.verification_status as enum ('incomplete', 'pending_verification', 'approved', 'rejected', 'suspended');
create type public.booking_status      as enum ('pending', 'confirmed', 'in_progress', 'gallery_uploaded', 'completed', 'disputed', 'cancelled');
create type public.payment_status      as enum ('pending', 'held', 'partially_released', 'fully_released', 'refunded');
create type public.payout_type         as enum ('deposit_release', 'final_release');
create type public.payout_status       as enum ('pending', 'processing', 'completed', 'failed');
create type public.message_type        as enum ('text', 'image', 'proof', 'system');
create type public.doc_type            as enum ('sa_id_front', 'sa_id_back', 'passport', 'selfie');
create type public.dispute_type        as enum ('photographer_no_show', 'client_no_show', 'poor_quality', 'not_delivered', 'other');
create type public.dispute_status      as enum ('open', 'investigating', 'resolved_client', 'resolved_photographer', 'closed');
create type public.pay_gateway         as enum ('payfast', 'ozow', 'snapscan');

---------------------------------------------------------------------------
-- Platform settings (single row; admin-editable so business rules are not hard-coded)
---------------------------------------------------------------------------
create table public.platform_settings (
  id                        boolean primary key default true check (id),
  platform_fee_rate         numeric(5,4) not null default 0.05,   -- SnapshotZA commission
  transaction_fee_rate      numeric(5,4) not null default 0.035,  -- gateway fees (approx.)
  bookings_per_tier         int          not null default 5,      -- completed bookings needed to climb one tier
  tier_min_rating           numeric(3,2) not null default 4.5,    -- promotion gate (not applied until the first review)
  tier1_deposit_share       numeric(3,2) not null default 0.30,   -- share of the NET amount released after the shoot
  tier2_deposit_share       numeric(3,2) not null default 0.40,
  tier3_deposit_share       numeric(3,2) not null default 0.50,
  post_shoot_release_hours  int          not null default 24,
  review_window_hours       int          not null default 48,     -- after delivery, before the final release (0 = instant)
  gallery_retention_days    int          not null default 15,     -- clients can download finals this long after delivery, then they are deleted
  free_cancel_hours         int          not null default 48,
  pending_hold_minutes      int          not null default 30,     -- unpaid booking holds the slot this long
  onboarding_min_photos     int          not null default 5,
  onboarding_min_packages   int          not null default 3,
  suspend_after_strikes     int          not null default 3,
  doc_retention_days        int          not null default 7       -- ID docs deleted this long after review
);
insert into public.platform_settings default values;

---------------------------------------------------------------------------
-- Users
---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  role              public.user_role not null default 'client',
  email             text,
  phone             text,
  full_name         text not null default '',
  profile_photo_url text,
  created_at        timestamptz not null default now(),
  last_login        timestamptz
);

create table public.photographer_profiles (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references public.profiles (id) on delete cascade,
  bio                 text not null default '',
  location            text not null default '',
  latitude            double precision,
  longitude           double precision,
  service_radius_km   int not null default 50 check (service_radius_km between 1 and 1000),
  specialties         text[] not null default '{}',
  tier                smallint not null default 1 check (tier in (1, 2, 3)),
  total_bookings      int not null default 0,
  average_rating      numeric(3,2) not null default 0,
  review_count        int not null default 0,
  id_verified         boolean not null default false,
  bank_verified       boolean not null default false,
  verification_status public.verification_status not null default 'incomplete',
  verification_note   text,
  strike_count        int not null default 0,
  instagram_handle    text,
  website_url         text,
  terms_accepted_at   timestamptz,
  created_at          timestamptz not null default now()
);
create index on public.photographer_profiles (verification_status, tier);
create index on public.photographer_profiles using gin (specialties);

-- Sensitive: bank account (FICA). Only the owner and admins can read it.
create table public.payout_accounts (
  id             uuid primary key default gen_random_uuid(),
  photographer_id uuid not null unique references public.photographer_profiles (id) on delete cascade,
  bank_name      text not null,
  account_holder text not null,
  account_number text not null check (account_number ~ '^[0-9]{7,16}$'),
  account_last4  text generated always as (right(account_number, 4)) stored,
  account_type   text not null check (account_type in ('cheque', 'savings')),
  branch_code    text not null check (branch_code ~ '^[0-9]{6}$'),
  verified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Sensitive: ID documents. Files live in the private 'verification-docs' storage bucket.
create table public.verification_documents (
  id              uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographer_profiles (id) on delete cascade,
  doc_type        public.doc_type not null,
  storage_path    text not null,
  created_at      timestamptz not null default now(),
  delete_after    timestamptz,                       -- POPIA: purge after review
  unique (photographer_id, doc_type)
);

---------------------------------------------------------------------------
-- Catalogue
---------------------------------------------------------------------------
create table public.packages (
  id                  uuid primary key default gen_random_uuid(),
  photographer_id     uuid not null references public.photographer_profiles (id) on delete cascade,
  name                text not null,
  description         text not null default '',
  price_zar           numeric(12,2) not null check (price_zar > 0),
  duration_hours      int not null check (duration_hours between 1 and 24),
  num_photos          int not null check (num_photos > 0),
  delivery_days       int not null check (delivery_days between 1 and 60),
  num_locations       int not null default 1 check (num_locations > 0),
  num_photographers   int not null default 1 check (num_photographers > 0),
  includes            text[] not null default '{}',
  is_popular          boolean not null default false,
  is_active           boolean not null default true,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now()
);
create index on public.packages (photographer_id) where is_active;

-- A day is bookable only when the photographer has explicitly opened it.
create table public.availability (
  photographer_id uuid not null references public.photographer_profiles (id) on delete cascade,
  day             date not null,
  is_open         boolean not null default true,
  primary key (photographer_id, day)
);

---------------------------------------------------------------------------
-- Bookings & money
---------------------------------------------------------------------------
create sequence public.booking_ref_seq start 1001;

create table public.bookings (
  id                uuid primary key default gen_random_uuid(),
  booking_ref       text not null unique default ('SZ-' || nextval('public.booking_ref_seq')),
  client_id         uuid not null references public.profiles (id),
  photographer_id   uuid not null references public.photographer_profiles (id),
  package_id        uuid not null references public.packages (id),
  shoot_date        date not null,
  shoot_time        time not null,
  shoot_starts_at   timestamptz not null,
  shoot_ends_at     timestamptz not null,
  shoot_location    text not null default '',
  -- Money. total_amount is what the client pays. net = total - platform_fee - transaction_fee.
  total_amount      numeric(12,2) not null check (total_amount > 0),
  platform_fee      numeric(12,2) not null,
  transaction_fee   numeric(12,2) not null,
  deposit_amount    numeric(12,2) not null default 0,   -- early release after the shoot (30/40/50% of net by tier)
  refund_amount     numeric(12,2) not null default 0,
  tier_at_booking   smallint not null check (tier_at_booking in (1, 2, 3)),
  gateway           public.pay_gateway not null,
  status            public.booking_status not null default 'pending',
  status_before_dispute public.booking_status,
  payment_status    public.payment_status not null default 'pending',
  deposit_released_at   timestamptz,
  final_released_at     timestamptz,
  gallery_uploaded_at   timestamptz,
  gallery_expires_at    timestamptz,     -- full-res files are deleted after this (see list_expired_galleries)
  gallery_purged_at     timestamptz,
  gallery_approved_at   timestamptz,
  no_show_reported_at   timestamptz,
  cancelled_by      uuid references public.profiles (id),
  cancelled_at      timestamptz,
  cancellation_reason text,
  created_at        timestamptz not null default now(),
  check (shoot_ends_at > shoot_starts_at)
);
create index on public.bookings (client_id, created_at desc);
create index on public.bookings (photographer_id, shoot_starts_at);
create index on public.bookings (status, payment_status);

-- Gateway transactions. Written only by the payment webhook (service role).
create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references public.bookings (id),
  gateway           public.pay_gateway not null,
  gateway_reference text not null,
  amount            numeric(12,2) not null,
  status            text not null default 'succeeded' check (status in ('succeeded', 'failed', 'refunded')),
  raw_payload       jsonb,
  created_at        timestamptz not null default now(),
  unique (gateway, gateway_reference)
);
create index on public.payments (booking_id);

create table public.payouts (
  id              uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographer_profiles (id),
  booking_id      uuid not null references public.bookings (id),
  amount          numeric(12,2) not null check (amount > 0),
  type            public.payout_type not null,
  status          public.payout_status not null default 'pending',
  bank_reference  text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index on public.payouts (photographer_id, status);
create index on public.payouts (booking_id);

---------------------------------------------------------------------------
-- Communication, media, reputation
---------------------------------------------------------------------------
create table public.chat_messages (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings (id) on delete cascade,
  sender_id      uuid references public.profiles (id),          -- null for system messages
  message_type   public.message_type not null default 'text',
  content        text not null default '',
  image_url      text,
  is_watermarked boolean not null default false,
  created_at     timestamptz not null default now(),
  check ((message_type = 'system') = (sender_id is null))
);
create index on public.chat_messages (booking_id, created_at);

create table public.photos (
  id                   uuid primary key default gen_random_uuid(),
  photographer_id      uuid not null references public.photographer_profiles (id) on delete cascade,
  booking_id           uuid references public.bookings (id) on delete cascade,
  url                  text not null,
  thumbnail_url        text,
  storage_path         text,           -- final (full-res) files: private Supabase Storage bucket 'deliveries'
  cloudinary_public_id text,           -- optional: Cloudinary id for watermarked previews / thumbnails
  is_watermarked       boolean not null default false,
  is_portfolio         boolean not null default false,
  is_cover             boolean not null default false,
  is_proof             boolean not null default false,
  upload_order         int not null default 0,
  created_at           timestamptz not null default now(),
  check (is_portfolio or booking_id is not null)
);
create index on public.photos (photographer_id) where is_portfolio;
create index on public.photos (booking_id) where booking_id is not null;

create table public.reviews (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null unique references public.bookings (id),
  client_id       uuid not null references public.profiles (id),
  photographer_id uuid not null references public.photographer_profiles (id),
  rating          int not null check (rating between 1 and 5),
  comment         text not null default '',
  created_at      timestamptz not null default now()
);
create index on public.reviews (photographer_id, created_at desc);

create table public.favorites (
  client_id       uuid not null references public.profiles (id) on delete cascade,
  photographer_id uuid not null references public.photographer_profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (client_id, photographer_id)
);

create table public.disputes (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id),
  raised_by    uuid not null references public.profiles (id),
  type         public.dispute_type not null,
  description  text not null default '',
  status       public.dispute_status not null default 'open',
  resolution   text,
  resolved_by  uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index on public.disputes (status, created_at);
