# Turning on photo delivery (one-time setup)

Photo delivery needs four small steps. The app already contains everything else; until these are done it shows
"Photo delivery is being set up" instead of failing.

## 1. Run the database update
Supabase -> **SQL Editor** -> **New query**. Paste the whole of
`supabase/migrations/20261114000010_deliveries.sql` and press **Run**.

## 2. Create the photo storage bucket
Cloudflare dashboard -> **R2 Object Storage** -> **Create bucket**.
- Name: `snapshotza-deliveries`
- Leave it **private** (do NOT turn on a public URL). Photos are only handed out by the app after it checks who is asking.

(R2 needs a payment method on file, but the free allowance - 10 GB, no download fees - covers early testing.)

## 3. Link the bucket to the app
Tell Claude/Kiro the bucket exists, or open `wrangler.jsonc` and remove the two `//` at the start of the
`"r2_buckets"` line (and add a comma after the `triggers` line). Commit and push; Cloudflare redeploys by itself.

## 4. Give the app its secret key (so only the app can store and release photos)
Supabase -> **Project Settings -> API Keys** -> copy the **service_role / secret** key.
Cloudflare -> **Workers & Pages -> snapshotza -> Settings -> Variables and secrets -> Add**:
- Type: **Secret**
- Name: `SUPABASE_SERVICE_KEY`
- Value: the key you copied

Never paste this key into chat, GitHub or any file. It lives only in Cloudflare.

## How it behaves
- Photographer: after a shoot is confirmed, upload the edited photos (JPG/PNG/WebP, up to 50 MB each), then **Deliver**.
  Delivery unlocks only when every photo in the package has really been uploaded.
- Client: sees previews as soon as photos are delivered; **full-size downloads unlock when they approve**.
  They have 15 days to download.
- Every day at about 04:17 SAST the app deletes galleries whose 15 days are over.
- Previews are 1600 px JPGs (not watermarked yet).
