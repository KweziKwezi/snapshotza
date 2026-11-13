# SnapshotZA security: what is in place, and what you must do

Plain language first. Technical detail is at the bottom.

## Do these in order

1. **Run the database updates** in the Supabase SQL Editor, in this order, one file at a time:
   `supabase/migrations/20261120000015_*.sql`, then `..._16_security_hardening.sql`, then `..._17_storage_hardening.sql`
   (skip any you already ran). Each should end with "Success".
2. **Set up two-step sign-in for your admin account** (see below). Do this straight after step 1, because from then on
   admin tools stop working until you do.
3. **Check the dashboard settings** (checklist below).
4. **Before real money: switch test mode off** (see "Before real payments").

## Two-step sign-in for admins

After migration 16 the database only accepts admin actions (approving photographers, seeing bank details, sending payouts,
deciding disputes) from someone who signed in with a password **and** a 6-digit code from an authenticator app.

First time:
1. Sign in as the admin. You land on "Your account" with a box **Turn on two-step sign-in**.
2. Tap **Set up my authenticator app**, scan the QR code with Google Authenticator or Microsoft Authenticator.
3. Type the 6-digit code. Admin tools now appear.

Each new sign-in will ask for a code. **Keep the authenticator app safe.** If you lose the phone, open Supabase,
Authentication, Users, pick your admin user and delete the factor, then set it up again.

## Supabase dashboard checklist

Authentication:
- Sign In / Providers, Email: **Confirm email ON**, **Secure email change ON**, **Secure password change ON**.
- Minimum password length: **8 or more** (10 is better). Turn on **leaked password protection** if your plan has it.
- URL Configuration: **Site URL** = `https://snapshotza.cyberglitch501.workers.dev` (or your own domain later).
  Under Redirect URLs, list only that address. Remove anything else (especially `localhost` and `*`).
- Multi-Factor: **TOTP enabled**.
- Rate limits: leave the defaults on.

Project:
- Advisors, Security Advisor: run it and fix anything marked red.
- Database, Extensions: `pg_cron` on. Database, Cron: you should see the job `process-due-payouts` (every 15 minutes).
- Cloudflare, Workers, `snapshotza`, Triggers: a daily cron (`17 2 * * *`). It deletes expired galleries, chats older than
  20 days, and ID documents after review. If this trigger is missing, none of those clean-ups happen.
- Settings, API: never put the **service_role** key anywhere except the Cloudflare secret `SUPABASE_SERVICE_KEY`.
  The key in `.env` must be the **publishable / anon** key.
- Storage: buckets `portfolio` and `avatars` are public (photos only, 5 MB, JPG/PNG/WebP). `verification-docs` must be **private**.

Cloudflare:
- The Worker secret `SUPABASE_SERVICE_KEY` is set. If it is ever pasted into chat, an email or GitHub, **rotate it** in Supabase
  (Settings, API) and update the Cloudflare secret.
- The R2 bucket `snapshotza-deliveries` must stay private (no public access, no custom domain).

GitHub:
- The repository is public. It holds no secrets (checked), but consider making it **private** before launch so nobody
  studies your payment rules.
- Turn on **Dependabot alerts** and **secret scanning** in the repo settings.

## Before real payments

The app is in **test mode**: anyone can press "Pay (test)". Before you take real money, run in the SQL Editor:

```sql
update public.platform_settings set simulate_payments = false;
```

That switches off all simulated payments and withdrawals. Then connect Paystack (webhook with signature check) before opening
to the public.

## What was found and fixed (migration 16, 17 and the Worker)

| Problem found | Fix |
| --- | --- |
| A client could create many unpaid bookings and block a photographer's calendar | Max 3 unpaid holds and 10 bookings per hour per client |
| Clients could read raw payment records | Payments table is admin-only |
| Reviews exposed who wrote them | Reviewer and booking hidden from the public |
| ID documents were kept forever (POPIA risk) | Deleted automatically after the check, with a daily clean-up job |
| Anyone could list every file in the photo buckets | Listing removed; direct links still work |
| Photographers could point photos at other websites | Photos must be in our own storage, in their own folder |
| Admin powers worked on a password alone | Admin needs a password plus an authenticator code |
| Default database permissions were wider than needed | Revoked, then granted only what the app uses |
| Sign-up revealed which emails already had accounts | Same neutral message either way |
| No limits on text lengths | Length and price limits on names, bios, packages, bank holder |
| Changing bank details or contact info was silent | Security notice sent to the owner of the account |
| No browser security headers | Content Security Policy, HSTS, no framing, no sniffing |

## What was checked and is fine

- Row Level Security is on for every table (checked by `node scripts/db-audit.mjs`).
- No secrets in the git history.
- 0 known vulnerabilities in production dependencies (`npm audit --omit=dev`).
- No inline scripts and no `eval`, so the strict content policy holds.
- Money rules are in the database, not the browser.

## Still to do (later)

- Paystack: payment webhook with signature check, then turn test mode off.
- CAPTCHA (Cloudflare Turnstile) on sign-up if you see fake accounts.
- Email/SMS alerts, legal pages (Terms, Privacy), custom domain.

## For developers

- `npm run test:db` (database rules, 579 checks), `npm run test:worker` (Worker, 50 checks), `node scripts/db-audit.mjs`
  (privilege audit), `npm run check:api` (live query shapes).
- Headers are generated at build time by `securityHeaders()` in `vite.config.js` into `dist/_headers`; the Worker adds the same
  headers to `/api` responses.
- `is_admin()` requires `role = 'admin'` and `auth.jwt()->>'aal' = 'aal2'`. The Worker reads `aal` from the verified token claims.
- `is_own_storage_url(url, bucket, owner)` enforces storage-only image URLs (trigger guards on photos, profile photo, documents).
- Document deletion: Worker cron calls `list_expired_documents()`, deletes via the Storage API, then `mark_documents_deleted()`.
