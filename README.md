# SnapshotZA (front-end prototype)

React + Vite + Tailwind v4. Mock data only, no backend yet.

```bash
npm install
npm run dev      # then open the printed URL (use a phone-size window)
npm run build
```

On desktop the app sits in a phone frame, with a side menu to jump to any screen.

## Added beyond the 12 Figma screens
| Screen | Why |
| --- | --- |
| Payment method | "Change" on Review & pay went nowhere. Offers Ozow (Instant EFT) or PayFast. |
| Gateway hand-off (mock) | Stand-in for the hosted Ozow / PayFast page. |
| Payment protection | Target of "View payment protection". |
| My bookings & escrow | The Bookings tab, with the escrow timeline and "Approve gallery & release payment". |
| Onboarding 4 · Payouts | Photographer bank details (bank, holder, account no., type, branch code). |

Verification is now step 5 of 5.

## Business rules (the database is the source of truth)
- The client pays exactly the package price. Our 5% fee and the ~3.5% gateway fee are deducted from the photographer's side.
- **Deposit** (released 24h after the shoot ends, unless a no-show/dispute is reported): Tier 1 = 30%, Tier 2 = 40%, Tier 3 = 50% of the net amount.
- **Final payment**: the remainder, once the photographer has uploaded *all* edited photos in the package and the client approves, or 48 hours pass.
- Every 5 completed bookings moves a photographer up one tier (max Tier 3). A 4.5+ rating gate applies once they have reviews.
- All numbers live in `platform_settings` and can be changed without code.
- Portfolio minimum at launch: 5 photos.
- **Photo retention:** clients can download their final photos for 15 days after delivery, then the full-res files are deleted (watermarked proofs are kept). Disputed bookings are never purged, and a resolved dispute guarantees at least 7 more days. Clients are reminded in the app and told to ask their photographer for a Google Drive link if they want a longer copy.

## Before going live
- Never handle card numbers yourself. Payment is entered on the Ozow / PayFast hosted page.
- Bank details and ID documents need server-side encryption, access controls and POPIA/FICA handling. The prototype stores nothing.
- Verify the account holder name against the ID (bank account verification service).
- Replace mock state in `src/store.jsx` with Supabase (client in `src/lib/supabase.js`, keys in `.env`, see `SUPABASE_SETUP.md`).

---

# Backend (Supabase)

`supabase/migrations/` holds the whole database layer:

| File | Contents |
| --- | --- |
| `…01_schema.sql` | Tables, enums, indexes, `platform_settings` (fees, tier thresholds, release timings — editable, not hard-coded) |
| `…02_logic.sql` | Escrow, fees, tiers, payouts, cancellations, disputes, onboarding, admin actions (SQL functions) |
| `…03_rls.sql` | Row Level Security, `public_photographers` view, realtime |
| `…04_storage_and_cron.sql` | Storage buckets (private `verification-docs`) and the 15-minute payout job (needs `pg_cron`) |

## Verify it locally (no Docker, no Supabase account)
```bash
npm run test:db
```
Loads migrations 1-3 into an in-process Postgres (PGlite) with a stub of Supabase's `auth` schema and roles, then
runs the full lifecycle as different users (241 checks): sign-up, onboarding, booking, payment webhook, chat, all three payout
tiers, the review window, auto-promotion, all cancellation cases, disputes, and that each role can only see and do what it should.
Migration 4 (storage, pg_cron) needs real Supabase and is **not** covered by this test.

## Apply to a real project
```bash
npx supabase init            # once
npx supabase link --project-ref <ref>
npx supabase db push
```
Then: enable `pg_cron`, set Auth providers (phone OTP + email), and create the first admin by hand:
`update public.profiles set role = 'admin' where email = '…';`

## How the app talks to it
Direct table reads (RLS-protected) plus RPC for anything that changes state:

| Action | Call |
| --- | --- |
| Browse | `from('public_photographers')`, `rpc('get_availability')` |
| Book | `rpc('create_booking')` → gateway → webhook calls `confirm_payment` (**service role only**) |
| Deliver / approve | `rpc('deliver_gallery')`, `rpc('approve_gallery')` |
| Cancel / dispute | `rpc('cancel_booking')`, `rpc('report_issue')` |
| Review | `rpc('submit_review')` |
| Onboarding | direct inserts, then `rpc('submit_for_verification')` |
| Admin | `admin_review_photographer`, `admin_resolve_dispute`, `admin_complete_payout`, `admin_verify_bank` |

## Still to build (not in the database)
- **Payment webhook** (Edge Function): verify the PayFast/Ozow signature, check amount, call `confirm_payment` with the service key.
  If it errors with "refund required", refund the customer.
- **Refund + payout execution:** the database records `refund_amount` and `payouts` rows; money movement is still manual EFT (or Stitch) and `admin_complete_payout`.
- **Photo storage (Cloudflare R2, private bucket):** an Edge Function uploads/signs URLs. Download links are issued only if `can_download_gallery(booking, user)` is true. A daily job calls `list_expired_galleries()`, deletes those R2 objects, then calls `mark_gallery_purged()`. A reminder job uses `list_expiring_galleries(n)` (e.g. 7, 3 and 1 days before).
- **Verification-docs purge:** rows carry `delete_after`; an Edge Function must delete the storage objects, then the rows.
- **Push/email/WhatsApp notifications**, admin web panel, rate limiting on OTP.
- **Encrypt `payout_accounts.account_number`** with Supabase Vault / pgsodium before launch. It is protected by RLS and revoked from `anon`, but not yet encrypted at column level.

## Photographer onboarding & admin review (live)
Signed-in photographers now save to Supabase at every step: profile and photo, portfolio (resized in the browser, stored in the public
`portfolio` bucket), packages, bank details, and ID documents (private `verification-docs` bucket). Submitting sets the account to
`pending_verification`; the photographer sees "under review" until an admin approves. Admins review everything (including signed links
to the private ID photos) in the app under Account -> Review photographers.

Run these in the Supabase SQL Editor, in order, after the first four migrations:
`20261110000005_portfolio_storage.sql` (photo buckets and rules), then `20261110000006_fix_public_read_policies.sql`.

## Checking the app's queries against the live API
`npm run check:api` sends every query shape the app uses to your Supabase project (read-only, anonymous) and fails on
PostgREST planning errors such as ambiguous embeds (PGRST201). Run it after any change to `src/lib/queries.js` or to table relationships.

## Marketplace (live)
The home screen, search/filters, photographer profile (portfolio, packages, reviews) and the date picker now read real data.
Photographers open their days under Studio -> Set your available days; clients can only book open days. Reserving a date
creates a real `pending` booking (the database holds the slot for 30 minutes); payment is connected in the next step.
Run `20261111000007_listing_thumbnails.sql` in the Supabase SQL Editor (home grid loads small thumbnails).
