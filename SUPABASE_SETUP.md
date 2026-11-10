# Supabase setup (about 20 minutes)

You do these steps on your own computer. Nothing here needs me to have access to your Supabase account.

## 1. Create the project
1. Go to https://supabase.com and sign up.
2. **New project**. Name: `snapshotza`. Set a strong **database password** and save it in a password manager (never share it).
3. **Region:** Supabase has **no South Africa region**. Pick **Central EU (Frankfurt)** or **West Europe (London)**. Both are about the same distance from SA.
   The region cannot be changed later. Because personal data will be stored outside South Africa, ask a POPIA-literate lawyer to check your privacy policy and cross-border transfer wording before launch.
4. Wait for the project to finish provisioning.

## 2. Install the CLI and push the database
In the project folder (`snapshotza/`), on a computer with Node 20+:
```bash
npx supabase login                         # opens a browser
npx supabase init                          # creates supabase/config.toml; keeps the existing migrations
npx supabase link --project-ref <REF>      # REF = the part before .supabase.co in your project URL
npx supabase db push                       # applies the 4 migrations
```
If `db push` fails on migration 4 with an extension error, enable **pg_cron** first:
Dashboard → Database → Extensions → search `pg_cron` → enable, then run `db push` again.

## 3. Get the two values I need
Dashboard → **Project Settings → API**:
- **Project URL**, like `https://abcd1234.supabase.co`
- **anon public key**, a long string starting with `eyJ…`

These two are safe to share; they are meant to be public. Row Level Security protects the data.

**Never share** the `service_role` key, the database password, or an access token. Those give full access.

Create `.env` in the project folder (copy `.env.example`) and fill both values in, or paste the URL and anon key to me and I will do it.

## 4. Turn on sign-in
Dashboard → **Authentication → Providers**
- **Email**: enabled by default.
- **Phone**: enable it, then choose an SMS provider (Twilio, MessageBird, Vonage or TextLocal). You need an account with one of them that can send SMS to South African numbers.
  - For development you can skip phone and use email sign-in, and add phone before launch.
- Authentication → **URL Configuration**: set Site URL to `http://localhost:5173` for now (change to your real domain later).

## 5. Create your admin account
1. Sign up in the app (or Dashboard → Authentication → Users → Add user) with your own email.
2. Dashboard → **SQL Editor**, run:
   ```sql
   update public.profiles set role = 'admin' where email = 'YOUR@EMAIL';
   ```
   There is intentionally no way to become admin from the app.

## 6. Storage buckets
Migration 4 creates `avatars` (public) and `verification-docs` (private). That is all you need in Supabase.
Final photos will go to a private Cloudflare R2 bucket instead (cheaper downloads); we set that up when we build photo delivery.

## 7. Later (not needed to start)
- **Edge Functions** for the PayFast/Ozow webhook and signed downloads. You will need the PayFast and Ozow merchant accounts (sandbox first).
- **Custom SMTP** for emails (the built-in sender is rate-limited and for testing only).
- **Backups**: the Free plan has none. Move to Pro before real customers or real money.
