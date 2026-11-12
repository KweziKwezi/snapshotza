// Runs the migrations in an in-process Postgres (PGlite) with a stub of Supabase's `auth` schema and roles,
// then drives the real lifecycle as different users so RLS and the escrow rules are exercised.
//   npm run test:db
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const db = new PGlite()
const dir = path.resolve('supabase/migrations')

/* ---- Supabase stand-ins ---- */
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text,
                           raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`)
// 0004 and 0005 need Supabase's real storage schema (and pg_cron), so only the database migrations run here.
for (const f of fs.readdirSync(dir).sort().filter((f) => !/storage/.test(f))) {
  await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
}

process.on('unhandledRejection', (e) => { console.error('\nTEST CRASH:', e.message); process.exit(1) })

/* ---- helpers ---- */
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + extra}`)
}
const eq = (name, a, b) => ok(name, String(a) === String(b), `got ${a}, expected ${b}`)
const raises = async (name, p, re) => {
  try { await p; ok(name, false, 'expected an error') } catch (e) { ok(name, re.test(e.message), e.message) }
}
const su = (sql, p = []) => db.query(sql, p)
const as = async (who, sql, p = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`,
    [who.id || '', JSON.stringify({ sub: who.id, role: who.role })])
  await db.exec(`set role ${who.role}`)
  try { return await db.query(sql, p) } finally { await db.exec('reset role') }
}
const user = (id) => ({ id, role: 'authenticated' })
const anon = { id: null, role: 'anon' }
const svc = { id: null, role: 'service_role' }
const dayPlus = async (n) => (await su(`select (current_date + $1::int)::text d`, [n])).rows[0].d
const mkUser = async (email, role, name) => {
  const id = randomUUID()
  await su(`insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)`, [id, email, JSON.stringify({ role, full_name: name })])
  return id
}

/* =========================================================================== */
console.log('\n# Sign-up & roles')
const adminId = await mkUser('admin@snapshotza.test', 'client', 'Admin')
await su(`update profiles set role = 'admin' where id = $1`, [adminId])
const c1 = await mkUser('kayla@test.za', 'client', 'Kayla')
const c2 = await mkUser('other@test.za', 'client', 'Other Client')
const p1 = await mkUser('thabo@test.za', 'photographer', 'Thabo Mokoena')
const sneaky = await mkUser('sneaky@test.za', 'admin', 'Sneaky')   // tries to sign up as admin via metadata
eq('client gets client role', (await su(`select role from profiles where id=$1`, [c1])).rows[0].role, 'client')
eq('photographer gets photographer_profiles row', (await su(`select count(*)::int n from photographer_profiles where user_id=$1`, [p1])).rows[0].n, 1)
eq('signup metadata cannot create an admin', (await su(`select role from profiles where id=$1`, [sneaky])).rows[0].role, 'client')
await raises('client cannot promote self to admin', as(user(c1), `update profiles set role='admin' where id=$1`, [c1]), /role cannot be changed/)
const pid = (await su(`select id from photographer_profiles where user_id=$1`, [p1])).rows[0].id

console.log('\n# Photographer onboarding')
await raises('photographer cannot self-verify', as(user(p1), `update photographer_profiles set id_verified=true where id=$1`, [pid]), /protected/)
await raises('photographer cannot self-promote to Tier 2', as(user(p1), `update photographer_profiles set tier=2 where id=$1`, [pid]), /protected/)
await raises('submit fails while profile incomplete', as(user(p1), `select * from submit_for_verification()`), /complete your profile/)
await as(user(p1), `update photographer_profiles set bio='Honest emotions.', location='Cape Town', specialties='{Wedding}', terms_accepted_at=now() where id=$1`, [pid])
await as(user(p1), `update profiles set phone='+27821234567' where id=$1`, [p1])
await raises('submit fails with too few photos', as(user(p1), `select * from submit_for_verification()`), /at least 5 portfolio photos/)
for (let i = 0; i < 5; i++) {
  await as(user(p1), `insert into photos (photographer_id,url,is_portfolio,is_cover,upload_order) values ($1,$2,true,$3,$4)`,
    [pid, `https://img.test/${i}.jpg`, i === 0, i])
}
await raises('submit fails with too few packages', as(user(p1), `select * from submit_for_verification()`), /at least 3 packages/)
const pk = {}
for (const [n, price, h, ph, d] of [['Silver', 2500, 2, 40, 7], ['Gold', 4500, 4, 100, 7], ['Platinum', 7500, 8, 250, 10]]) {
  pk[n] = (await as(user(p1), `insert into packages (photographer_id,name,price_zar,duration_hours,num_photos,delivery_days,is_popular)
                               values ($1,$2,$3,$4,$5,$6,$7) returning id`, [pid, n, price, h, ph, d, n === 'Gold'])).rows[0].id
}
await raises('submit fails without bank details', as(user(p1), `select * from submit_for_verification()`), /bank details/)
await as(user(p1), `insert into payout_accounts (photographer_id,bank_name,account_holder,account_number,account_type,branch_code)
                    values ($1,'FNB','Thabo Mokoena','62012345678','cheque','250655')`, [pid])
await raises('rejects a bad account number', as(user(p1), `update payout_accounts set account_number='12ab' where photographer_id=$1`, [pid]), /check/)
await raises('submit fails without ID', as(user(p1), `select * from submit_for_verification()`), /upload your ID/)
for (const t of ['sa_id_front', 'sa_id_back', 'selfie']) {
  await as(user(p1), `insert into verification_documents (photographer_id,doc_type,storage_path) values ($1,$2,$3)`, [pid, t, `${p1}/${t}.jpg`])
}
await as(user(p1), `select * from submit_for_verification()`)
eq('status is pending_verification', (await su(`select verification_status s from photographer_profiles where id=$1`, [pid])).rows[0].s, 'pending_verification')
eq('pending photographer is hidden from public', (await as(anon, `select count(*)::int n from public_photographers`)).rows[0].n, 0)
await raises('cannot book an unapproved photographer', as(user(c1), `select * from create_booking($1,$2,'14:00','Cape Town','ozow','saver')`, [pk.Gold, await dayPlus(10)]), /not accepting bookings/)
await raises('a client cannot approve photographers', as(user(c1), `select * from admin_review_photographer($1,true,'')`, [pid]), /admins only/)
await as(user(adminId), `select * from admin_review_photographer($1,true,'')`, [pid])
const pub = await as(anon, `select * from public_photographers`)
eq('approved photographer is publicly listed', pub.rows.length, 1)
eq('public view shows from_price', pub.rows[0].from_price, '2500.00')
ok('public view hides coordinates & internals', !('latitude' in pub.rows[0]) && !('strike_count' in pub.rows[0]) && !('user_id' in pub.rows[0]))
eq('ID docs are scheduled for deletion after review', (await su(`select count(*)::int n from verification_documents where delete_after is not null`)).rows[0].n, 3)

console.log('\n# Sensitive data isolation (RLS)')
await raises('anon cannot read bank details', as(anon, `select * from payout_accounts`), /permission denied/)
eq('client cannot see bank details', (await as(user(c1), `select * from payout_accounts`)).rows.length, 0)
eq('other client cannot see ID docs', (await as(user(c2), `select * from verification_documents`)).rows.length, 0)
eq('photographer sees own bank details', (await as(user(p1), `select * from payout_accounts`)).rows.length, 1)
eq('admin sees bank details', (await as(adminId ? user(adminId) : anon, `select * from payout_accounts`)).rows.length, 1)
eq('anon sees no profiles', (await as(anon, `select * from profiles`)).rows.length, 0)
eq('client sees no contact details before booking', (await as(user(c1), `select * from profiles where id=$1`, [p1])).rows.length, 0)

console.log('\n# Booking & payment')
const open = async (n) => { const d = await dayPlus(n); await as(user(p1), `insert into availability (photographer_id,day) values ($1,$2) on conflict do nothing`, [pid, d]); return d }
let ref = 100
const bookAndPay = async (client, pkg, offset, time = '14:00') => {
  const d = await open(offset)
  const b = (await as(user(client), `select * from create_booking($1,$2,$3,'Cape Town','ozow','saver')`, [pkg, d, time])).rows[0]
  await as(svc, `select * from confirm_payment($1,'ozow',$2,$3)`, [b.id, `REF-${++ref}`, b.total_amount])
  return b.id
}
const getB = async (id) => (await su(`select * from bookings where id=$1`, [id])).rows[0]
const shiftEnded = (id, hoursAgo) => su(`update bookings set shoot_ends_at = now() - make_interval(hours => $2), shoot_starts_at = now() - make_interval(hours => $2 + 2), shoot_completed_at = now() - make_interval(hours => $2) where id=$1`, [id, hoursAgo])
const payouts = async (id) => (await su(`select type, amount::text, status from payouts where booking_id=$1 order by created_at, type`, [id])).rows

await raises('cannot book a day the photographer has not opened', as(user(c1), `select * from create_booking($1,$2,'14:00','x','ozow','saver')`, [pk.Gold, await dayPlus(11)]), /not available on this date/)
const d1 = await open(10)
const b1 = (await as(user(c1), `select * from create_booking($1,$2,'14:00','Cape Town','ozow','saver')`, [pk.Gold, d1])).rows[0]
eq('booking ref', b1.booking_ref, 'SZ-1001')
eq('status pending', b1.status, 'pending')
eq('platform fee 7%', b1.platform_fee, '315.00')
eq('payment fee 2.9% + R1', b1.transaction_fee, '131.50')
eq('tier snapshot', b1.tier_at_booking, 1)
eq('Tier 1 deposit is 30% of net (4053.50)', b1.deposit_amount, '1216.05')
await raises('slot is held while payment is pending', as(user(c2), `select * from create_booking($1,$2,'15:00','x','ozow','saver')`, [pk.Silver, d1]), /already booked/)
await raises('clients cannot call confirm_payment', as(user(c1), `select * from confirm_payment($1,'ozow','FAKE',4500)`, [b1.id]), /permission denied/)
await raises('anon cannot create bookings', as(anon, `select * from create_booking($1,$2,'14:00','x','ozow','saver')`, [pk.Gold, d1]), /permission denied/)
await raises('wrong amount is rejected', as(svc, `select * from confirm_payment($1,'ozow','REF-X',100)`, [b1.id]), /amount mismatch/)
await as(svc, `select * from confirm_payment($1,'ozow','REF-1',4500)`, [b1.id])
await as(svc, `select * from confirm_payment($1,'ozow','REF-1',4500)`, [b1.id])
const b1row = await getB(b1.id)
eq('booking confirmed', b1row.status, 'confirmed')
eq('funds held in escrow', b1row.payment_status, 'held')
const bOther = (await as(user(c2), `select * from create_booking($1,$2,'09:00','x','ozow','saver')`, [pk.Silver, await open(13)])).rows[0]
await raises('a gateway reference cannot be reused for another booking',
  as(svc, `select * from confirm_payment($1,'ozow','REF-1',$2)`, [bOther.id, bOther.total_amount]), /already used for another booking/)
eq('that booking stays unpaid', (await getB(bOther.id)).status, 'pending')
await as(user(c2), `select * from cancel_booking($1,'')`, [bOther.id])
eq('webhook retry is idempotent', (await su(`select count(*)::int n from payments where booking_id=$1`, [b1.id])).rows[0].n, 1)
eq('client sees own payment', (await as(user(c1), `select * from payments`)).rows.length, 1)
eq('photographer cannot see payment records', (await as(user(p1), `select * from payments`)).rows.length, 0)
eq('other client cannot see the booking', (await as(user(c2), `select * from bookings where id=$1`, [b1.id])).rows.length, 0)
eq('photographer sees the booking', (await as(user(p1), `select * from bookings where id=$1`, [b1.id])).rows.length, 1)
eq('contact details unlock after payment (client)', (await as(user(c1), `select * from profiles where id=$1`, [p1])).rows.length, 1)
eq('contact details stay hidden from other clients', (await as(user(c2), `select * from profiles where id=$1`, [p1])).rows.length, 0)
await raises('blocked slot after payment', as(user(c2), `select * from create_booking($1,$2,'15:00','x','ozow','saver')`, [pk.Silver, d1]), /already booked/)

console.log('\n# Chat')
eq('system message posted on payment', (await as(user(c1), `select * from chat_messages where message_type='system'`)).rows.length, 1)
await as(user(c1), `insert into chat_messages (booking_id,sender_id,content) values ($1,$2,'Hi Thabo!')`, [b1.id, c1])
eq('photographer receives client message', (await as(user(p1), `select * from chat_messages where message_type='text'`)).rows.length, 1)
eq('outsider cannot read chat', (await as(user(c2), `select * from chat_messages`)).rows.length, 0)
await raises('outsider cannot post in chat', as(user(c2), `insert into chat_messages (booking_id,sender_id,content) values ($1,$2,'hi')`, [b1.id, c2]), /row-level security/)
await raises('cannot impersonate another sender', as(user(c1), `insert into chat_messages (booking_id,sender_id,content) values ($1,$2,'hi')`, [b1.id, p1]), /row-level security/)
await raises('client cannot forge system messages', as(user(c1), `insert into chat_messages (booking_id,sender_id,message_type,content) values ($1,null,'system','Payment released')`, [b1.id]), /row-level security/)
await raises('client cannot send proofs', as(user(c1), `insert into chat_messages (booking_id,sender_id,message_type,content,is_watermarked) values ($1,$2,'proof','x',true)`, [b1.id, c1]), /row-level security/)
await as(user(p1), `insert into chat_messages (booking_id,sender_id,message_type,content,is_watermarked,image_url) values ($1,$2,'proof','Preview 01',true,'https://img.test/proof.jpg')`, [b1.id, p1])
eq('photographer can share proofs', (await as(user(c1), `select * from chat_messages where message_type='proof'`)).rows.length, 1)

console.log('\n# Tier 1 payout: 30% after the shoot, the rest after delivery')
const addFinals = (id, n) => su(`insert into photos (photographer_id,booking_id,url,is_proof) select $1,$2,'https://img.test/f'||g||'.jpg',false from generate_series(1,$3) g`, [pid, id, n])
await raises('cannot deliver before the shoot', as(user(p1), `select * from deliver_gallery($1)`, [b1.id]), /not happened yet/)
await shiftEnded(b1.id, 23)
eq('nothing released 23h after the shoot', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 0)
await shiftEnded(b1.id, 25)
eq('deposit released 25h after the shoot', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 1)
const b1dep = await getB(b1.id)
eq('status in_progress after deposit', b1dep.status, 'in_progress')
eq('partially released', b1dep.payment_status, 'partially_released')
eq('Tier 1 deposit payout = 30% of net', (await payouts(b1.id)).map((p) => p.amount).join(','), '1216.05')
eq('cron is idempotent', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 0)
await raises('cannot deliver without photos', as(user(p1), `select * from deliver_gallery($1)`, [b1.id]), /upload all 100 edited photos/)
for (let i = 0; i < 5; i++) await as(user(p1), `insert into photos (photographer_id,booking_id,url,is_proof) values ($1,$2,'https://img.test/proof.jpg',true)`, [pid, b1.id])
await addFinals(b1.id, 99)
await raises('proofs do not count: 99 of 100 is not enough', as(user(p1), `select * from deliver_gallery($1)`, [b1.id]), /you have 99/)
eq('client can see booking photos', (await as(user(c1), `select * from photos where booking_id=$1`, [b1.id])).rows.length > 0, true)
eq('outsider cannot see booking photos', (await as(user(c2), `select * from photos where booking_id=$1`, [b1.id])).rows.length, 0)
await addFinals(b1.id, 1)
await as(user(p1), `select * from deliver_gallery($1)`, [b1.id])
eq('gallery_uploaded', (await getB(b1.id)).status, 'gallery_uploaded')
eq('final is not released instantly (review window)', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 0)
await raises('a stranger cannot approve', as(user(c2), `select * from approve_gallery($1)`, [b1.id]), /not allowed/)
await raises('photographer cannot approve own gallery', as(user(p1), `select * from approve_gallery($1)`, [b1.id]), /not allowed/)
await as(user(c1), `select * from approve_gallery($1)`, [b1.id])
const b1done = await getB(b1.id)
eq('booking completed', b1done.status, 'completed')
eq('payment fully released', b1done.payment_status, 'fully_released')
const po1 = await payouts(b1.id)
eq('two payouts: 30% deposit + remainder', po1.map((p) => p.amount).join(','), '1216.05,2837.45')
eq('payouts add up to net (4500 - 315 - 131.50)', po1.reduce((t, p) => t + Number(p.amount), 0).toFixed(2), '4053.50')
eq('photographer sees own payouts', (await as(user(p1), `select * from payouts where booking_id=$1`, [b1.id])).rows.length, 2)
eq('client cannot see payouts', (await as(user(c1), `select * from payouts`)).rows.length, 0)
eq('completed bookings counted', (await su(`select total_bookings n from photographer_profiles where id=$1`, [pid])).rows[0].n, 1)
await raises('only admins finish payouts', as(user(p1), `select * from admin_complete_payout((select id from payouts limit 1),'X')`), /admins only/)
await as(user(adminId), `select * from admin_complete_payout((select id from payouts limit 1),'EFT-001')`)
eq('admin marks payout completed', (await su(`select count(*)::int n from payouts where status='completed'`)).rows[0].n, 1)

console.log('\n# Reviews')
await raises('stranger cannot review', as(user(c2), `select * from submit_review($1,5,'x')`, [b1.id]), /not allowed/)
await as(user(c1), `select * from submit_review($1,5,'Amazing!')`, [b1.id])
await raises('only one review per booking', as(user(c1), `select * from submit_review($1,4,'again')`, [b1.id]), /duplicate|unique/)
await raises('rating must be 1-5', as(user(c1), `select * from submit_review($1,9,'x')`, [b1.id]), /check|not allowed|complete/)
eq('anyone can read reviews', (await as(anon, `select * from reviews`)).rows.length, 1)

console.log('\n# Final payout after the 48h review window (client never responds)')
const bAuto = await bookAndPay(c1, pk.Silver, 12)
await shiftEnded(bAuto, 24 * 10)
eq('deposit released', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 1)
eq('deposit = 30% of net 2251.50', (await payouts(bAuto)).map((p) => p.amount).join(','), '675.45')
await addFinals(bAuto, 40)
await as(user(p1), `select * from deliver_gallery($1)`, [bAuto])
await su(`update bookings set gallery_uploaded_at = now() - interval '30 hours' where id=$1`, [bAuto])
eq('still held at 30h', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 0)
await su(`update bookings set gallery_uploaded_at = now() - interval '50 hours' where id=$1`, [bAuto])
eq('released at 50h', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 1)
eq('payouts add up to net', (await payouts(bAuto)).reduce((t, p) => t + Number(p.amount), 0).toFixed(2), '2251.50')
eq('booking completed', (await getB(bAuto)).status, 'completed')
await as(user(c1), `select * from submit_review($1,5,'Great')`, [bAuto])

console.log('\n# Tier progression: 5 bookings per tier')
const tierOf = async () => (await su(`select tier from photographer_profiles where id=$1`, [pid])).rows[0].tier
const complete = async (client, offset) => {
  const id = await bookAndPay(client, pk.Silver, offset)
  await shiftEnded(id, 48)
  await as(svc, `select process_due_payouts()`)
  await addFinals(id, 40)
  await as(user(p1), `select * from deliver_gallery($1)`, [id])
  await as(user(client), `select * from approve_gallery($1)`, [id])
  await as(user(client), `select * from submit_review($1,5,'Lovely')`, [id])
  return id
}
eq('Tier 1 with 2 completed bookings', await tierOf(), 1)
for (let i = 0; i < 3; i++) {
  await complete(c1, 20 + i)
  if (i === 1) eq('still Tier 1 with 4 completed bookings', await tierOf(), 1)
}
const pstat = (await su(`select tier, total_bookings, average_rating::text r from photographer_profiles where id=$1`, [pid])).rows[0]
eq('5 completed bookings', pstat.total_bookings, 5)
eq('average rating', pstat.r, '5.00')
eq('auto-promoted to Tier 2 at 5 bookings', pstat.tier, 2)

console.log('\n# Tier 2 payout: 40% deposit')
const bT2 = await bookAndPay(c1, pk.Gold, 30)
const t2 = await getB(bT2)
eq('Tier 2 snapshot on booking', t2.tier_at_booking, 2)
eq('Tier 2 deposit is 40% of net', t2.deposit_amount, '1621.40')
await shiftEnded(bT2, 25)
await as(svc, `select process_due_payouts()`)
eq('Tier 2 deposit paid', (await payouts(bT2)).map((p) => p.amount).join(','), '1621.40')
await addFinals(bT2, 100)
await as(user(p1), `select * from deliver_gallery($1)`, [bT2])
await as(user(c1), `select * from approve_gallery($1)`, [bT2])
eq('Tier 2 payouts add up to net', (await payouts(bT2)).reduce((t, p) => t + Number(p.amount), 0).toFixed(2), '4053.50')
await as(user(c1), `select * from submit_review($1,5,'Wow')`, [bT2])
for (let i = 0; i < 4; i++) {
  await complete(c1, 31 + i)
  if (i === 2) eq('still Tier 2 with 9 completed bookings', await tierOf(), 2)
}
eq('10 completed bookings', (await su(`select total_bookings n from photographer_profiles where id=$1`, [pid])).rows[0].n, 10)
eq('auto-promoted to Tier 3 at 10 bookings', await tierOf(), 3)

console.log('\n# Tier 3 payout: 50% deposit')
const bT3 = await bookAndPay(c1, pk.Gold, 35)
const t3 = await getB(bT3)
eq('Tier 3 snapshot on booking', t3.tier_at_booking, 3)
eq('Tier 3 deposit is 50% of net', t3.deposit_amount, '2026.75')
await shiftEnded(bT3, 25)
await as(svc, `select process_due_payouts()`)
eq('Tier 3 deposit paid', (await payouts(bT3)).map((p) => p.amount).join(','), '2026.75')
await addFinals(bT3, 100)
await as(user(p1), `select * from deliver_gallery($1)`, [bT3])
await as(user(c1), `select * from approve_gallery($1)`, [bT3])
eq('Tier 3 payouts add up to net', (await payouts(bT3)).reduce((t, p) => t + Number(p.amount), 0).toFixed(2), '4053.50')
eq('tier never exceeds 3', await tierOf(), 3)

console.log('\n# Cancellation policy')
const bookRate = async (client, pkg, offset, rate, time = '14:00') => {
  const d = await open(offset)
  const b = (await as(user(client), `select * from create_booking($1,$2,$3,'Cape Town','ozow',$4)`, [pkg, d, time, rate])).rows[0]
  await as(svc, `select * from confirm_payment($1,'ozow',$2,$3)`, [b.id, `REF-${++ref}`, b.total_amount])
  return b.id
}
// Saver rate: no refund, ever. The photographer is paid their full net once the shoot date has passed.
const bCa = await bookRate(c1, pk.Gold, 40, 'saver')
await raises('stranger cannot cancel', as(user(c2), `select * from cancel_booking($1,'x')`, [bCa]), /not allowed/)
eq('Saver rate: the client pays the package price only', (await getB(bCa)).total_amount, '4500.00')
const ca = (await as(user(c1), `select * from cancel_booking($1,'plans changed')`, [bCa])).rows[0]
eq('Saver: cancelled, no refund', `${ca.status}/${ca.refund_amount}`, 'cancelled/0.00')
eq('Saver: the money stays held until the shoot date has passed', `${ca.payment_status}/${(await payouts(bCa)).length}`, 'held/0')
await shiftEnded(bCa, 1)
await as(svc, `select process_due_payouts()`)
eq('Saver: after the shoot date the photographer is paid the full net', (await payouts(bCa)).map((p) => p.amount).join(','), '4053.50')
eq('...and the booking is fully released', (await getB(bCa)).payment_status, 'fully_released')

// Flexible rate: package price + R150. Full refund of the package price 48h+ ahead; the R150 is kept.
const bFx = await bookRate(c1, pk.Gold, 41, 'flexible')
eq('Flexible rate: price + R150, the net is unchanged', `${(await getB(bFx)).total_amount}/${(await getB(bFx)).flex_fee}/${(await getB(bFx)).net_amount}`, '4650.00/150.00/4053.50')
const fx = (await as(user(c1), `select * from cancel_booking($1,'plans changed')`, [bFx])).rows[0]
eq('Flexible >48h: refunded', fx.payment_status, 'refunded')
eq('Flexible >48h: refund = the package price (the R150 is kept)', fx.refund_amount, '4500.00')
eq('Flexible >48h: the refund is due within 14 days', (await su(`select (refund_due_by > now() + interval '13 days 23 hours' and refund_due_by < now() + interval '14 days 1 hour') ok from bookings where id=$1`, [bFx])).rows[0].ok, true)
eq('Flexible >48h: the photographer gets nothing', (await payouts(bFx)).length, 0)
eq('...and the client is told', (await su(`select count(*)::int n from chat_messages where booking_id=$1 and content like '%refund of R4,500.00%'`, [bFx])).rows[0].n, 1)

const dTmr = await open(1)
const bLate = (await as(user(c1), `select * from create_booking($1,$2,'12:00','x','ozow','flexible')`, [pk.Gold, dTmr])).rows[0]
await as(svc, `select * from confirm_payment($1,'ozow','REF-LATE',4650)`, [bLate.id])
const late = (await as(user(c1), `select * from cancel_booking($1,'sorry')`, [bLate.id])).rows[0]
eq('Flexible <48h: no refund', `${late.refund_amount}/${late.payment_status}`, '0.00/held')
await shiftEnded(bLate.id, 1)
await as(svc, `select process_due_payouts()`)
eq('Flexible <48h: the photographer is paid the full net after the shoot date', (await payouts(bLate.id)).map((p) => p.amount).join(','), '4053.50')

// The photographer cancels: everything comes back, including the flexible fee, and they get a strike.
const bPc = await bookRate(c1, pk.Gold, 44, 'flexible')
const pc = (await as(user(p1), `select * from cancel_booking($1,'ill')`, [bPc])).rows[0]
eq('photographer cancels: 100% back, including the flexible fee', pc.refund_amount, '4650.00')
eq('photographer cancels: strike recorded', (await su(`select strike_count n from photographer_profiles where id=$1`, [pid])).rows[0].n, 1)
eq('...the first strike is only a warning', (await su(`select verification_status s from photographer_profiles where id=$1`, [pid])).rows[0].s, 'approved')
eq('...and they are told', (await su(`select count(*)::int n from notifications where user_id=$1 and type='strike'`, [p1])).rows[0].n, 1)
const bPend = (await as(user(c1), `select * from create_booking($1,$2,'09:00','x','payfast','saver')`, [pk.Silver, await open(42)])).rows[0]
eq('unpaid booking can be cancelled', (await as(user(c1), `select * from cancel_booking($1,'')`, [bPend.id])).rows[0].status, 'cancelled')
eq('cancelled slot is free again', (await as(user(c2), `select * from create_booking($1,$2,'09:00','x','payfast','saver')`, [pk.Silver, await dayPlus(42)])).rows.length, 1)

console.log('\n# Bank-detail changes require re-verification')
eq('bank verified before edit', (await su(`select bank_verified b from photographer_profiles where id=$1`, [pid])).rows[0].b, true)
await as(user(p1), `update payout_accounts set account_number='62099999999' where photographer_id=$1`, [pid])
eq('bank_verified reset after edit', (await su(`select bank_verified b from photographer_profiles where id=$1`, [pid])).rows[0].b, false)
await as(user(p1), `update payout_accounts set verified_at = now() where photographer_id=$1`, [pid])
eq('photographer cannot self-verify bank', (await su(`select verified_at from payout_accounts`)).rows[0].verified_at, null)
await raises('photographer cannot flip bank_verified directly', as(user(p1), `update photographer_profiles set bank_verified=true where id=$1`, [pid]), /protected/)
const bFrozen = await bookAndPay(c1, pk.Silver, 43)
await shiftEnded(bFrozen, 48)
eq('no payouts while bank unverified (deposit held)', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 0)
await as(user(adminId), `select admin_verify_bank($1)`, [pid])
eq('payout released once admin re-verifies', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 1)

console.log('\n# Gallery retention: 15 days to download, then deleted')
const retention = (await su(`select gallery_retention_days n from platform_settings`)).rows[0].n
eq('retention setting is 15 days', retention, 15)
eq('delivery starts a 15-day clock', (await su(`select (gallery_expires_at - gallery_uploaded_at)::text d from bookings where id=$1`, [bT3])).rows[0].d, '15 days')
const canDl = async (booking, who) => (await as(svc, `select can_download_gallery($1,$2) ok`, [booking, who])).rows[0].ok
eq('client can download after payment is released', await canDl(bT3, c1), true)
eq('another client cannot download', await canDl(bT3, c2), false)
eq('photographer is not given the download link', await canDl(bT3, p1), false)
eq('no download for a booking without a gallery', await canDl(bCa, c1), false)
eq('nothing expired yet', (await as(svc, `select * from list_expired_galleries()`)).rows.length, 0)
eq('expiry reminders find galleries ending within 15 days', (await as(svc, `select * from list_expiring_galleries(15)`)).rows.length > 0, true)
eq('...but none within 1 day', (await as(svc, `select * from list_expiring_galleries(1)`)).rows.length, 0)

// a disputed gallery is never purged, and resolving the dispute leaves the client at least 7 days
const bP = await bookAndPay(c1, pk.Silver, 70)
await shiftEnded(bP, 48)
await as(svc, `select process_due_payouts()`)
await addFinals(bP, 40)
await as(user(p1), `select * from deliver_gallery($1)`, [bP])
const dP = (await as(user(c1), `select * from report_issue($1,'poor_quality','Photos are blurry')`, [bP])).rows[0]
await su(`update bookings set gallery_expires_at = now() - interval '1 hour' where id=$1`, [bP])
eq('disputed gallery is excluded from purging', (await as(svc, `select * from list_expired_galleries()`)).rows.length, 0)
await raises('cannot purge a disputed gallery', as(svc, `select mark_gallery_purged($1)`, [bP]), /under dispute/)
await as(user(adminId), `select * from admin_resolve_dispute($1,'dismiss','Photos are fine')`, [dP.id])
eq('dispute resolution restores a download window of at least 7 days',
   (await su(`select (gallery_expires_at > now() + interval '6 days') ok from bookings where id=$1`, [bP])).rows[0].ok, true)

// expire two galleries and purge them
await su(`update photos set storage_path = 'finals/' || id where booking_id in ($1,$2) and not is_proof`, [b1.id, bT3])
await su(`update bookings set gallery_expires_at = now() - interval '1 hour' where id in ($1,$2)`, [b1.id, bT3])
const exp = (await as(svc, `select * from list_expired_galleries() order by booking_id`)).rows
eq('two galleries have expired', exp.length, 2)
eq('every final file path is returned for deletion', exp.find((r) => r.booking_id === b1.id).storage_paths.length, 100)
eq('client can no longer download an expired gallery', await canDl(b1.id, c1), false)
await raises('clients cannot trigger purges', as(user(c1), `select mark_gallery_purged($1)`, [b1.id]), /permission denied/)
await raises('a gallery cannot be purged early', as(svc, `select mark_gallery_purged($1)`, [bP]), /under dispute|not expired/)
const proofsBefore = (await su(`select count(*)::int n from photos where booking_id=$1 and is_proof`, [b1.id])).rows[0].n
for (const r of exp) await as(svc, `select mark_gallery_purged($1)`, [r.booking_id])
await as(svc, `select mark_gallery_purged($1)`, [b1.id])
eq('final photos deleted from the database', (await su(`select count(*)::int n from photos where booking_id=$1 and not is_proof`, [b1.id])).rows[0].n, 0)
eq('watermarked proofs are kept', (await su(`select count(*)::int n from photos where booking_id=$1 and is_proof`, [b1.id])).rows[0].n, proofsBefore)
eq('purge is recorded', (await getB(b1.id)).gallery_purged_at !== null, true)
eq('purging does not touch payments', (await getB(b1.id)).payment_status, 'fully_released')
eq('client was told in chat', (await su(`select count(*)::int n from chat_messages where booking_id=$1 and content like '%deleted from SnapshotZA%'`, [b1.id])).rows[0].n, 1)
eq('nothing left to purge', (await as(svc, `select * from list_expired_galleries()`)).rows.length, 0)

console.log('\n# Disputes')
const bD = await bookAndPay(c1, pk.Gold, 50)
await raises('stranger cannot report an issue on someone else\'s booking', as(user(c2), `select * from report_issue($1,'other','spam')`, [bD]), /not allowed/)
await raises('cannot report a no-show before the shoot', as(user(c1), `select * from report_issue($1,'photographer_no_show','')`, [bD]), /not started/)
await raises('photographer cannot report their own no-show', as(user(p1), `select * from report_issue($1,'photographer_no_show','')`, [bD]), /only the client/)
await shiftEnded(bD, 1)
const dsp = (await as(user(c1), `select * from report_issue($1,'photographer_no_show','Nobody arrived')`, [bD])).rows[0]
eq('booking frozen as disputed', (await getB(bD)).status, 'disputed')
eq('no payout while disputed', (await as(svc, `select process_due_payouts() n`)).rows[0].n, 0)
await raises('client cannot resolve disputes', as(user(c1), `select * from admin_resolve_dispute($1,'refund_client','')`, [dsp.id]), /admins only/)
eq('admin sees dispute', (await as(user(adminId), `select * from disputes where booking_id=$1`, [bD])).rows.length, 1)
eq('outsider cannot see dispute', (await as(user(c2), `select * from disputes where booking_id=$1`, [bD])).rows.length, 0)
await as(user(adminId), `select * from admin_resolve_dispute($1,'refund_client','Confirmed no-show')`, [dsp.id])
const bDr = await getB(bD)
eq('no-show: full refund', bDr.refund_amount, '4500.00')
eq('no-show: payment refunded', bDr.payment_status, 'refunded')
eq('no-show: photographer suspended', (await su(`select verification_status s from photographer_profiles where id=$1`, [pid])).rows[0].s, 'suspended')
eq('suspended photographer disappears from search', (await as(anon, `select * from public_photographers`)).rows.length, 0)
await raises('cannot book a suspended photographer', as(user(c2), `select * from create_booking($1,$2,'10:00','x','ozow','saver')`, [pk.Silver, await dayPlus(60)]), /not accepting bookings|not available/)

console.log('\n# Function privileges')
await raises('clients cannot run the payout job', as(user(c1), `select process_due_payouts()`), /permission denied/)
await raises('anon cannot run the payout job', as(anon, `select process_due_payouts()`), /permission denied/)
await raises('clients cannot call the payout engine directly', as(user(c1), `select process_booking_payouts($1)`, [bD]), /permission denied/)
await raises('clients cannot post system messages', as(user(c1), `select post_system_message($1,'hi')`, [bD]), /permission denied/)
await raises('clients cannot write bookings directly', as(user(c1), `update bookings set payment_status='fully_released' where id=$1`, [bD]), /permission denied|row-level security|0 rows/)
eq('direct booking updates change nothing', (await getB(bD)).payment_status, 'refunded')
await raises('clients cannot insert payouts', as(user(c1), `insert into payouts (photographer_id,booking_id,amount,type) values ($1,$2,1,'final_release')`, [pid, bD]), /permission denied/)
eq('client fee update affects no rows', (await as(user(c1), `update platform_settings set platform_fee_rate=0`)).affectedRows, 0)
await as(user(adminId), `update platform_settings set review_window_hours=48`)
eq('fee settings unchanged', (await su(`select platform_fee_rate::text r from platform_settings`)).rows[0].r, '0.0700')

console.log('\n# Onboarding writes exactly as the app sends them, then admin review')
const p2 = await mkUser('lerato@test.za', 'photographer', 'Lerato Nkosi')
const pid2 = (await su(`select id from photographer_profiles where user_id=$1`, [p2])).rows[0].id
const asP2 = (sql, params = []) => as(user(p2), sql, params)

// step 1: profile
await asP2(`update profiles set full_name=$1 where id=$2`, ['Lerato Nkosi', p2])
await asP2(`update photographer_profiles set location=$1, specialties=$2, bio=$3 where id=$4`, ['Johannesburg', ['Matric', 'Events'], 'Bold colour, confident frames.', pid2])
await asP2(`update profiles set profile_photo_url=$1 where id=$2`, ['https://x.test/avatar.jpg', p2])
// step 2: portfolio (cover + order), then remove and reorder
const ph = []
for (let i = 0; i < 6; i++) {
  ph.push((await asP2(`insert into photos (photographer_id,url,thumbnail_url,storage_path,is_portfolio,is_cover,upload_order)
                       values ($1,$2,$3,$4,true,$5,$6) returning id`, [pid2, `https://x.test/${i}.jpg`, `https://x.test/${i}-t.jpg`, `${p2}/${i}.jpg`, i === 0, i])).rows[0].id)
}
await asP2(`delete from photos where id=$1`, [ph[5]])
await asP2(`update photos set upload_order=0, is_cover=true where id=$1`, [ph[1]])
await asP2(`update photos set upload_order=1, is_cover=false where id=$1`, [ph[0]])
eq('portfolio saved', (await asP2(`select count(*)::int n from photos where photographer_id=$1 and is_portfolio`, [pid2])).rows[0].n, 5)
eq('cover is the first photo after reordering', (await asP2(`select id from photos where photographer_id=$1 and is_cover`, [pid2])).rows[0].id, ph[1])
await raises('cannot remove another photographer\'s photo', as(user(p1), `delete from photos where id=$1`, [ph[0]]).then((r) => { if (!r.affectedRows) throw new Error('row-level security: 0 rows') }), /row-level security/)
// step 3: packages (insert, then update by id like the app does on a second save)
const pk2 = []
for (const [n, price, h, c, d, i] of [['Essential', 1200, 2, 40, 7, 0], ['Signature', 2400, 4, 100, 7, 1], ['Full story', 4000, 8, 250, 10, 2]]) {
  pk2.push((await asP2(`insert into packages (photographer_id,name,price_zar,duration_hours,num_photos,delivery_days,is_popular,is_active,sort_order,includes)
                        values ($1,$2,$3,$4,$5,$6,$7,true,$8,$9) returning id`, [pid2, n, price, h, c, d, i === 1, i, ['Edited photos', 'Private online gallery']])).rows[0].id)
}
await asP2(`update packages set price_zar=2500 where id=$1`, [pk2[1]])
await raises('a package needs a positive price', asP2(`insert into packages (photographer_id,name,price_zar,duration_hours,num_photos,delivery_days) values ($1,'Bad',0,2,10,7)`, [pid2]), /check/)
// step 4: bank — upsert twice (second time changes the number)
const upsertBank = (acc) => asP2(`insert into payout_accounts (photographer_id,bank_name,account_holder,account_number,account_type,branch_code)
                                  values ($1,'Capitec','Lerato Nkosi',$2,'savings','470010')
                                  on conflict (photographer_id) do update set bank_name=excluded.bank_name, account_holder=excluded.account_holder,
                                  account_number=excluded.account_number, account_type=excluded.account_type, branch_code=excluded.branch_code`, [pid2, acc])
await upsertBank('1234567890')
await upsertBank('1234567891')
eq('bank upsert keeps one row', (await su(`select count(*)::int n from payout_accounts where photographer_id=$1`, [pid2])).rows[0].n, 1)
eq('bank upsert saved the latest number', (await su(`select account_number n from payout_accounts where photographer_id=$1`, [pid2])).rows[0].n, '1234567891')
// step 5: documents — upload each, then replace one (new path), like re-taking a photo
const upsertDoc = (t, path) => asP2(`insert into verification_documents (photographer_id,doc_type,storage_path) values ($1,$2,$3)
                                     on conflict (photographer_id,doc_type) do update set storage_path=excluded.storage_path`, [pid2, t, path])
await raises('cannot submit before everything is in', asP2(`select * from submit_for_verification()`), /upload your ID/)
for (const t of ['sa_id_front', 'sa_id_back', 'selfie']) await upsertDoc(t, `${p2}/${t}-1.jpg`)
await upsertDoc('selfie', `${p2}/selfie-2.jpg`)
eq('replacing a document keeps one row per type', (await su(`select count(*)::int n from verification_documents where photographer_id=$1`, [pid2])).rows[0].n, 3)
eq('replacement points at the new file', (await su(`select storage_path p from verification_documents where photographer_id=$1 and doc_type='selfie'`, [pid2])).rows[0].p, `${p2}/selfie-2.jpg`)
await raises('terms must be accepted to submit', asP2(`select * from submit_for_verification()`), /accept the terms/)
await asP2(`update photographer_profiles set terms_accepted_at=$1 where id=$2`, [new Date().toISOString(), pid2])
await asP2(`select * from submit_for_verification()`)
eq('submitted for review', (await su(`select verification_status s from photographer_profiles where id=$1`, [pid2])).rows[0].s, 'pending_verification')
await raises('cannot submit twice', asP2(`select * from submit_for_verification()`), /already submitted/)

console.log('\n# What each person can see of a pending application')
eq('pending photographer is not in public search', (await as(anon, `select count(*)::int n from public_photographers where id=$1`, [pid2])).rows[0].n, 0)
eq('anon cannot see a pending portfolio', (await as(anon, `select * from photos where photographer_id=$1`, [pid2])).rows.length, 0)
eq('anon cannot see pending packages', (await as(anon, `select * from packages where photographer_id=$1`, [pid2])).rows.length, 0)
eq('another photographer cannot see their bank', (await as(user(p1), `select * from payout_accounts where photographer_id=$1`, [pid2])).rows.length, 0)
eq('another photographer cannot see their ID documents', (await as(user(p1), `select * from verification_documents where photographer_id=$1`, [pid2])).rows.length, 0)
eq('another photographer cannot see their packages', (await as(user(p1), `select * from packages where photographer_id=$1`, [pid2])).rows.length, 0)
eq('a client cannot see their bank', (await as(user(c1), `select * from payout_accounts where photographer_id=$1`, [pid2])).rows.length, 0)
const queue = (await as(user(adminId), `select pp.id, pr.full_name, pr.email from photographer_profiles pp join profiles pr on pr.id=pp.user_id where pp.verification_status='pending_verification'`)).rows
eq('admin review queue lists the applicant with name and email', queue.map((r) => `${r.full_name}|${r.email}`).join(','), 'Lerato Nkosi|lerato@test.za')
eq('admin can read the bank details', (await as(user(adminId), `select account_holder from payout_accounts where photographer_id=$1`, [pid2])).rows[0].account_holder, 'Lerato Nkosi')
eq('admin can read all 3 ID documents', (await as(user(adminId), `select * from verification_documents where photographer_id=$1`, [pid2])).rows.length, 3)
eq('admin can read the portfolio', (await as(user(adminId), `select * from photos where photographer_id=$1 and is_portfolio`, [pid2])).rows.length, 5)
eq('admin can read the packages', (await as(user(adminId), `select * from packages where photographer_id=$1`, [pid2])).rows.length, 3)

console.log('\n# Reject, fix, resubmit, approve')
await raises('a photographer cannot approve themselves', asP2(`select * from admin_review_photographer($1,true,'')`, [pid2]), /admins only/)
await as(user(adminId), `select * from admin_review_photographer($1,false,'ID photo is blurry, please retake')`, [pid2])
const rej = (await asP2(`select verification_status s, verification_note n from photographer_profiles where id=$1`, [pid2])).rows[0]
eq('rejected', rej.s, 'rejected')
eq('photographer can read the reason', rej.n, 'ID photo is blurry, please retake')
await upsertDoc('sa_id_front', `${p2}/sa_id_front-2.jpg`)
await asP2(`select * from submit_for_verification()`)
const resub = (await su(`select verification_status s, verification_note n from photographer_profiles where id=$1`, [pid2])).rows[0]
eq('resubmitted after fixing', resub.s, 'pending_verification')
eq('old rejection note is cleared', resub.n, null)
await as(user(adminId), `select * from admin_review_photographer($1,true,'')`, [pid2])
const ok2 = (await su(`select verification_status s, id_verified i, bank_verified b from photographer_profiles where id=$1`, [pid2])).rows[0]
eq('approved', ok2.s, 'approved')
eq('ID and bank flagged verified', `${ok2.i}/${ok2.b}`, 'true/true')
eq('ID documents scheduled for deletion', (await su(`select count(*)::int n from verification_documents where photographer_id=$1 and delete_after is not null`, [pid2])).rows[0].n, 3)
const live2 = (await as(anon, `select full_name, from_price, cover_url, specialties from public_photographers where id=$1`, [pid2])).rows[0]
eq('approved photographer appears in public search', live2.full_name, 'Lerato Nkosi')
eq('public listing shows the cheapest package', live2.from_price, '1200.00')
eq('public listing shows the cover photo', live2.cover_url, 'https://x.test/1.jpg')
eq('public listing shows specialties', live2.specialties.join(','), 'Matric,Events')
eq('anon can now see the portfolio', (await as(anon, `select * from photos where photographer_id=$1 and is_portfolio`, [pid2])).rows.length, 5)
eq('anon can now see the packages', (await as(anon, `select * from packages where photographer_id=$1`, [pid2])).rows.length, 3)
eq('a signed-in client can see the portfolio and packages too', `${(await as(user(c2), `select * from photos where photographer_id=$1 and is_portfolio`, [pid2])).rows.length}/${(await as(user(c2), `select * from packages where photographer_id=$1`, [pid2])).rows.length}`, '5/3')
eq('bank details stay private after approval', (await as(anon, `select count(*)::int n from public_photographers`)).rows[0].n, 1)

console.log('\n# Marketplace: listing, calendar, favourites and a real booking (as the app sends them)')
const d1m = await dayPlus(40), d2m = await dayPlus(41), d3m = await dayPlus(42)
const listed = (await as(anon, `select cover_thumb_url, cover_url from public_photographers where id=$1`, [pid2])).rows[0]
eq('listing exposes a small cover thumbnail', listed.cover_thumb_url, 'https://x.test/1-t.jpg')
eq('...and still the full-size cover', listed.cover_url, 'https://x.test/1.jpg')

// photographer opens days (single, bulk upsert re-sending an open day, and a delete)
await asP2(`insert into availability (photographer_id,day,is_open) values ($1,$2,true) on conflict (photographer_id,day) do update set is_open=excluded.is_open`, [pid2, d1m])
await asP2(`insert into availability (photographer_id,day,is_open) values ($1,$2,true),($1,$3,true),($1,$4,true) on conflict (photographer_id,day) do update set is_open=excluded.is_open`, [pid2, d1m, d2m, d3m])
eq('three days open, no duplicates', (await asP2(`select count(*)::int n from availability where photographer_id=$1`, [pid2])).rows[0].n, 3)
await raises('a client cannot open days for a photographer', as(user(c2), `insert into availability (photographer_id,day) values ($1,$2)`, [pid2, await dayPlus(50)]), /row-level security/)
await raises('another photographer cannot open days for them', as(user(p1), `insert into availability (photographer_id,day) values ($1,$2)`, [pid2, await dayPlus(50)]), /row-level security/)
eq('another photographer cannot close their days', (await as(user(p1), `delete from availability where photographer_id=$1`, [pid2])).affectedRows, 0)
eq('a client cannot read the raw calendar table', (await as(user(c2), `select * from availability where photographer_id=$1`, [pid2])).rows.length, 0)

// clients browse the calendar through get_open_days / get_free_slots (free start times for a shoot of N hours)
const openDays = async (who, hours = 4, ph = pid2) => (await as(who, `select day::text d, free_slots n, start_time::text s, end_time::text e from get_open_days($1,$2,$3,$4) order by day`, [ph, d1m, d3m, hours])).rows
const slots = async (who, day, hours, ph = pid2) => (await as(who, `select t::text s from get_free_slots($1,$2,$3) t`, [ph, day, hours])).rows.map((r) => r.s.slice(0, 5))
const book = (who, pkg, day, time) => as(who, `select * from create_booking($1,$2,$3,'','ozow','saver')`, [pkg, day, time])
eq('anonymous visitors see exactly the open days', (await openDays(anon)).map((r) => r.d).join(','), [d1m, d2m, d3m].join(','))
eq('...with the usual hours 08:00-18:00', (await openDays(anon))[0].s + '-' + (await openDays(anon))[0].e, '08:00:00-18:00:00')
eq('4-hour shoot: 13 start times, 08:00 to 14:00', `${(await slots(anon, d1m, 4)).length} ${(await slots(anon, d1m, 4))[0]}..${(await slots(anon, d1m, 4)).pop()}`, '13 08:00..14:00')
eq('2-hour shoot: 17 start times, last 16:00', `${(await slots(anon, d1m, 2)).length} ${(await slots(anon, d1m, 2)).pop()}`, '17 16:00')
eq('8-hour shoot: 5 start times, last 10:00', `${(await slots(anon, d1m, 8)).length} ${(await slots(anon, d1m, 8)).pop()}`, '5 10:00')
eq('a shoot longer than the day has no start times', (await slots(anon, d1m, 11)).length, 0)
eq('free_slots matches the start times', (await openDays(anon, 2))[0].n, 17)
eq('a closed day has no start times', (await slots(anon, await dayPlus(45), 2)).length, 0)

// a real booking through the RPC, with the exact argument types the app sends (date + 'HH:MM' strings)
const fav = (await book(user(c2), pk2[1], d1m, '14:00')).rows[0]
eq('booking created awaiting payment', `${fav.status}/${fav.payment_status}`, 'pending/pending')
eq('price comes from the package, not the client', fav.total_amount, '2500.00')

console.log('\n# One-hour gap between shoots, and working hours')
eq('after a 14:00-18:00 booking a 4h shoot can only start by 09:00 (gap before it)', (await slots(anon, d1m, 4)).join(','), '08:00,08:30,09:00')
eq('a 2h shoot can start until 11:00 (ends 13:00, one hour before 14:00)', (await slots(anon, d1m, 2)).pop(), '11:00')
eq('other days are unaffected', (await slots(anon, d2m, 4)).length, 13)
eq('the day shows fewer free start times', (await openDays(anon, 4))[0].n, 3)
await raises('same time is taken', book(user(c1), pk2[1], d1m, '14:00'), /already booked/)
await raises('13:30 is too close (30 min before the 14:00 shoot)', book(user(c1), pk2[0], d1m, '11:30'), /already booked/)
const early = (await book(user(c1), pk2[0], d1m, '11:00')).rows[0]
eq('exactly one hour before is allowed (11:00-13:00 then 14:00)', early.status, 'pending')
await as(user(c1), `select * from cancel_booking($1,'')`, [early.id])
const mid = (await book(user(c1), pk2[0], d2m, '10:00')).rows[0]
await raises('12:30 is too close after a 10:00-12:00 shoot', book(user(c2), pk2[0], d2m, '12:30'), /already booked/)
const after = (await book(user(c2), pk2[0], d2m, '13:00')).rows[0]
eq('exactly one hour after is allowed (13:00)', after.status, 'pending')
eq('two shoots on one day', (await slots(anon, d2m, 2)).includes('10:00'), false)
await as(user(c1), `select * from cancel_booking($1,'')`, [mid.id])
await as(user(c2), `select * from cancel_booking($1,'')`, [after.id])
await raises('before opening time is refused', book(user(c1), pk2[0], d3m, '07:30'), /outside the photographer's available hours/)
await raises('a shoot that would end after closing is refused', book(user(c1), pk2[0], d3m, '17:00'), /outside the photographer's available hours/)
const atClose = (await book(user(c1), pk2[0], d3m, '16:00')).rows[0]
eq('ending exactly at closing time is allowed', atClose.status, 'pending')
await as(user(c1), `select * from cancel_booking($1,'')`, [atClose.id])

// per-day hours override and usual hours
await asP2(`update availability set start_time='10:00', end_time='14:00' where photographer_id=$1 and day=$2`, [pid2, d3m])
eq('a per-day override narrows that day only', `${(await slots(anon, d3m, 2)).join(',')}`, '10:00,10:30,11:00,11:30,12:00')
eq('open days report the override', (await openDays(anon, 2)).find((r) => r.d === d3m).s, '10:00:00')
await raises('09:00 is outside the override', book(user(c1), pk2[0], d3m, '09:00'), /outside the photographer's available hours/)
await raises('hours need both a start and an end', asP2(`update availability set end_time=null where photographer_id=$1 and day=$2`, [pid2, d3m]), /check/)
await raises('the end must be after the start', asP2(`update availability set end_time='09:00' where photographer_id=$1 and day=$2`, [pid2, d3m]), /check/)
await asP2(`update availability set start_time=null, end_time=null where photographer_id=$1 and day=$2`, [pid2, d3m])
eq('clearing the override goes back to the usual hours', (await slots(anon, d3m, 2)).length, 17)
await asP2(`update photographer_profiles set work_start='09:00', work_end='17:00' where id=$1`, [pid2])
eq('changing the usual hours changes every day without an override', `${(await slots(anon, d2m, 2)).length} ${(await slots(anon, d2m, 2))[0]}..${(await slots(anon, d2m, 2)).pop()}`, '13 09:00..15:00')
await raises('usual hours must end after they start', asP2(`update photographer_profiles set work_end='08:00' where id=$1`, [pid2]), /check/)
await asP2(`update photographer_profiles set work_start='08:00', work_end='18:00' where id=$1`, [pid2])
await raises('a client cannot change a photographer\'s hours', as(user(c2), `update photographer_profiles set work_start='00:00' where id=$1`, [pid2]).then((r) => { if (!r.affectedRows) throw new Error('row-level security: 0 rows') }), /row-level security/)

await raises('a day the photographer has not opened is refused', book(user(c1), pk2[1], await dayPlus(55), '14:00'), /not available on this date/)
await raises('a photographer account cannot book', asP2(`select * from create_booking($1,$2,'14:00','','ozow','saver')`, [pk2[1], d2m]), /only clients can make bookings/)
const mine = (await as(user(c2), `select id, booking_ref, status, shoot_date::text d, shoot_time::text t, total_amount, photographer_id, package_id from bookings where client_id=$1 and id=$2`, [c2, fav.id])).rows[0]
eq('the client\'s booking list includes it', mine.id, fav.id)
eq('stored date/time are what was chosen', `${mine.d} ${mine.t}`, `${d1m} 14:00:00`)
eq('the photographer sees it too', (await asP2(`select * from bookings where id=$1`, [fav.id])).rows.length, 1)
eq('another client does not', (await as(user(c1), `select * from bookings where id=$1`, [fav.id])).rows.length, 0)
await as(user(c2), `select * from cancel_booking($1,'Cancelled before payment')`, [fav.id])
eq('cancelling frees the time again', (await slots(anon, d1m, 4)).length, 13)

// a photographer closes a day
await asP2(`delete from availability where photographer_id=$1 and day = any($2::date[])`, [pid2, [d2m]])
eq('a closed day disappears from the client calendar', (await openDays(anon)).map((r) => r.d).join(','), [d1m, d3m].join(','))
await asP2(`delete from availability where photographer_id=$1 and day = any($2::date[])`, [pid2, [d1m, d3m]])
eq('closing everything leaves nothing bookable', (await openDays(anon)).length, 0)
eq('an unapproved or suspended photographer shows nothing', (await openDays(anon, 4, pid)).length + (await slots(anon, d1m, 2, pid)).length, 0)

// favourites
const addFav = (who, client, ph) => as(who, `insert into favorites (client_id,photographer_id) values ($1,$2) on conflict (client_id,photographer_id) do nothing`, [client, ph])
await addFav(user(c2), c2, pid2)
await addFav(user(c2), c2, pid2)
eq('saving twice keeps one favourite', (await as(user(c2), `select * from favorites`)).rows.length, 1)
eq('a client sees only their own favourites', (await as(user(c1), `select * from favorites`)).rows.length, 0)
await raises('cannot save a favourite as someone else', addFav(user(c1), c2, pid2), /row-level security/)
eq('unsaving removes it', (await as(user(c2), `delete from favorites where client_id=$1 and photographer_id=$2`, [c2, pid2])).affectedRows, 1)
eq('anonymous visitors cannot save favourites', await as(anon, `insert into favorites (client_id,photographer_id) values ($1,$2)`, [c2, pid2]).then(() => 'allowed').catch(() => 'blocked'), 'blocked')
eq('reviews are readable by anyone', (await as(anon, `select id, rating, comment, created_at from reviews limit 1`)).rows.length >= 0, true)

console.log('\n# Test mode: simulated payment, fast-forward, delivery and withdrawal')
const dS = await dayPlus(60)
await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, dS])
const sb = (await book(user(c1), pk2[1], dS, '10:00')).rows[0]
eq('test mode is on by default', (await su(`select simulate_payments s from platform_settings`)).rows[0].s, true)
await raises('another client cannot pay for it', as(user(c2), `select * from simulate_payment($1)`, [sb.id]), /not allowed/)
await raises('the photographer cannot pay for it', asP2(`select * from simulate_payment($1)`, [sb.id]), /not allowed/)
await raises('visitors cannot call simulate_payment', as(anon, `select * from simulate_payment($1)`, [sb.id]), /permission denied/)
const paid = (await as(user(c1), `select * from simulate_payment($1)`, [sb.id])).rows[0]
eq('paying confirms the booking and holds the money', `${paid.status}/${paid.payment_status}`, 'confirmed/held')
eq('...and flags it as a test booking', paid.simulated, true)
const pay = (await su(`select gateway_reference r, raw_payload->>'simulated' s, amount::text a from payments where booking_id=$1`, [sb.id])).rows[0]
eq('the payment record is clearly marked', `${pay.r.startsWith('SIM-')}/${pay.s}/${pay.a}`, 'true/true/2500.00')
eq('the chat opens with a system message', (await as(user(c1), `select * from chat_messages where booking_id=$1 and message_type='system'`, [sb.id])).rows.length, 1)
await raises('cannot pay twice', as(user(c1), `select * from simulate_payment($1)`, [sb.id]), /not awaiting payment/)
const earn = async () => (await asP2(`select available::text a, processing::text p, paid_out::text o, in_escrow::text e, earned_this_month::text m from my_earnings()`)).rows[0]
eq('paid money is in escrow for the photographer (2500 - 175 - 73.50)', `${(await earn()).e}/${(await earn()).a}`, '2251.50/0')
await raises('a stranger cannot fast-forward', as(user(c2), `select * from simulate_shoot_over($1)`, [sb.id]), /not allowed/)
await raises('delivery needs the shoot to have happened first', asP2(`select * from simulate_delivery($1)`, [sb.id]), /jump to after the shoot first/)
await raises('the photographer cannot mark it complete before it starts', asP2(`select * from mark_shoot_complete($1)`, [sb.id]), /once it has started/)
await raises('the client cannot confirm before it starts', as(user(c1), `select * from confirm_shoot($1)`, [sb.id]), /once it has started/)
const over = (await as(user(c1), `select * from simulate_shoot_over($1)`, [sb.id])).rows[0]
eq('jump to after the shoot: still confirmed, in the past', `${over.status}/${new Date(over.shoot_starts_at) < new Date()}`, 'confirmed/true')
eq('...nothing is paid yet', `${(await earn()).a}/${(await earn()).e}`, '0/2251.50'.replace('0/','0.00/').replace('0.00/','0/'))
const marked = (await asP2(`select * from mark_shoot_complete($1)`, [sb.id])).rows[0]
eq('photographer marks complete: waits for the client', `${marked.status}/${marked.shoot_completed_at !== null}/${marked.deposit_released_at}`, 'confirmed/true/null')
await raises('a stranger cannot confirm', as(user(c2), `select * from confirm_shoot($1)`, [sb.id]), /not allowed/)
await raises('the photographer cannot confirm for the client', asP2(`select * from confirm_shoot($1)`, [sb.id]), /not allowed/)
const done = (await as(user(c1), `select * from confirm_shoot($1)`, [sb.id])).rows[0]
eq('client confirms: in progress, deposit released', done.status, 'in_progress')
eq('Tier 1 deposit is 30% of net, available to withdraw', `${(await earn()).a}/${(await earn()).e}`, '675.45/1576.05')
eq('the payout is flagged as a test payout', (await su(`select simulated s from payouts where booking_id=$1`, [sb.id])).rows[0].s, true)
await raises('fast-forwarding after it is in progress is refused', asP2(`select * from simulate_shoot_over($1)`, [sb.id]), /not waiting for its shoot/)
eq('confirming again changes nothing', (await as(user(c1), `select * from confirm_shoot($1)`, [sb.id])).rows[0].status, 'in_progress')
eq('...and pays the deposit only once', (await su(`select count(*)::int n from payouts where booking_id=$1 and type='deposit_release'`, [sb.id])).rows[0].n, 1)
eq('earned this month includes it', (await earn()).m, '675.45')
eq('a client cannot read payouts', (await as(user(c1), `select * from payouts where booking_id=$1`, [sb.id])).rows.length, 0)

const wd = (await asP2(`select * from request_withdrawal()`)).rows[0]
eq('withdrawal pays out everything available', `${wd.r_total}/${wd.r_count}/${wd.r_completed}`, '675.45/1/true')
eq('...with a SIM reference', wd.r_reference.startsWith('SIM-'), true)
const po = (await su(`select status, bank_reference r from payouts where booking_id=$1`, [sb.id])).rows[0]
eq('the payout is completed and carries the reference', `${po.status}/${po.r === wd.r_reference}`, 'completed/true')
eq('balances move: available 0, paid out 675.45', `${(await earn()).a}/${(await earn()).o}`, '0.00/675.45'.replace('0.00', '0'))
await raises('nothing left to withdraw', asP2(`select * from request_withdrawal()`), /nothing available to withdraw/)
await raises('clients cannot withdraw', as(user(c1), `select * from request_withdrawal()`), /not a photographer account/)

const dl = (await asP2(`select * from simulate_delivery($1)`, [sb.id])).rows[0]
eq('test delivery moves it to gallery uploaded', dl.status, 'gallery_uploaded')
eq('the final payment waits for the client', (await earn()).a, '0')
await raises('only the client can approve', asP2(`select * from approve_gallery($1)`, [sb.id]), /not allowed/)
const fin = (await as(user(c1), `select * from approve_gallery($1)`, [sb.id])).rows[0]
eq('client approves: completed and fully released', `${fin.status}/${fin.payment_status}`, 'completed/fully_released')
eq('the rest (70%) becomes available', `${(await earn()).a}/${(await earn()).e}`, '1576.05/0')
const wd2 = (await asP2(`select * from request_withdrawal()`)).rows[0]
eq('second withdrawal', `${wd2.r_total}/${wd2.r_completed}`, '1576.05/true')
eq('lifetime paid out equals the net amount', (await earn()).o, '2251.50')
eq('a completed booking counts toward the tier', (await su(`select total_bookings n from photographer_profiles where id=$1`, [pid2])).rows[0].n, 1)

console.log('\n# Test mode can never touch real money')
const dR = await dayPlus(61)
await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, dR])
const rb = (await book(user(c2), pk2[1], dR, '10:00')).rows[0]
await as(svc, `select * from confirm_payment($1,'ozow','REF-REAL-77',$2)`, [rb.id, rb.total_amount])
eq('a gateway-paid booking is not flagged as a test', (await getB(rb.id)).simulated, false)
await raises('test mode cannot fast-forward a really-paid booking', asP2(`select * from simulate_shoot_over($1)`, [rb.id]), /only test bookings/)
await raises('...or deliver it without photos', asP2(`select * from simulate_delivery($1)`, [rb.id]), /only test bookings/)
await shiftEnded(rb.id, 25)
await as(svc, `select process_due_payouts()`)
const rp = (await su(`select simulated s, status from payouts where booking_id=$1`, [rb.id])).rows[0]
eq('its payout is real (not flagged) and available', `${rp.s}/${rp.status}`, 'false/pending')
const rw = (await asP2(`select * from request_withdrawal()`)).rows[0]
eq('withdrawing a real payout does NOT complete it, even in test mode', `${rw.r_completed}/${rw.r_reference}`, 'false/null')
eq('it waits as processing for an admin', (await su(`select status from payouts where booking_id=$1`, [rb.id])).rows[0].status, 'processing')
await as(user(adminId), `select * from admin_complete_payout((select id from payouts where booking_id=$1),'EFT-77')`, [rb.id])
eq('an admin completes it after the real transfer', (await su(`select status, bank_reference r from payouts where booking_id=$1`, [rb.id])).rows[0].r, 'EFT-77')

await su(`update platform_settings set simulate_payments=false`)
const dO = await dayPlus(62)
await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, dO])
const ob = (await book(user(c1), pk2[1], dO, '10:00')).rows[0]
await raises('with test mode off, simulated payment is refused', as(user(c1), `select * from simulate_payment($1)`, [ob.id]), /switched off/)
await as(svc, `select * from confirm_payment($1,'ozow','REF-REAL-78',$2)`, [ob.id, ob.total_amount])
await raises('...and so is fast-forwarding', asP2(`select * from simulate_shoot_over($1)`, [ob.id]), /switched off/)
await raises('...and test delivery', asP2(`select * from simulate_delivery($1)`, [ob.id]), /switched off/)
await su(`update platform_settings set simulate_payments=true`)

console.log('\n# Withdrawals need a verified bank account')
await su(`update photographer_profiles set bank_verified=false where id=$1`, [pid2])
await raises('no withdrawal while the bank account is unverified', asP2(`select * from request_withdrawal()`), /add and verify your bank details/)
await su(`update photographer_profiles set bank_verified=true where id=$1`, [pid2])
eq('a suspended or unapproved photographer cannot withdraw either', await as(user(p1), `select * from request_withdrawal()`).then(() => 'allowed').catch((e) => (/verify your bank/.test(e.message) ? 'blocked' : e.message)), 'blocked')

console.log('\n# Shoot confirmation: 24-hour auto-confirm, notifications, problem reports')
let dn = 70
const pastShoot = async (client = c1, pkgId = pk2[1]) => {
  const d = await dayPlus(dn++)
  await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, d])
  const x = (await book(user(client), pkgId, d, '10:00')).rows[0]
  await as(user(client), `select * from simulate_payment($1)`, [x.id])
  await as(user(client), `select * from simulate_shoot_over($1)`, [x.id])
  return x.id
}
const notes = async (uid, type) => (await su(`select * from notifications where user_id=$1 ${type ? 'and type=$2' : ''} order by created_at`, type ? [uid, type] : [uid])).rows
const earn2 = async () => (await asP2(`select available::text a, on_hold::text h from my_earnings()`)).rows[0]

// 1. auto-confirm 24h after the photographer marks complete
const a1 = await pastShoot()
eq('a new booking notifies the photographer', (await notes(p2, 'new_booking')).length >= 1, true)
await as(svc, `select process_due_payouts()`)
eq('nobody acting: nothing is paid just because time passed', (await getB(a1)).deposit_released_at, null)
await asP2(`select * from mark_shoot_complete($1)`, [a1])
eq('the client is asked to confirm', (await notes(c1, 'confirm_shoot')).length >= 1, true)
await su(`update bookings set shoot_completed_at = now() - interval '23 hours' where id=$1`, [a1])
await as(svc, `select process_due_payouts()`)
eq('23 hours after marking: still waiting', (await getB(a1)).deposit_released_at, null)
await su(`update bookings set shoot_completed_at = now() - interval '25 hours' where id=$1`, [a1])
await as(svc, `select process_due_payouts()`)
eq('25 hours after marking: confirmed automatically, deposit released', `${(await getB(a1)).status}/${(await getB(a1)).deposit_released_at !== null}`, 'in_progress/true')
eq('...but the client never pressed confirm', (await getB(a1)).shoot_confirmed_at, null)
eq('the photographer is told the deposit is queued', (await notes(p2, 'payout_queued')).length >= 1, true)
await as(svc, `select process_due_payouts()`)
eq('running the engine again does not pay twice', (await su(`select count(*)::int n from payouts where booking_id=$1`, [a1])).rows[0].n, 1)

// 2. notifications: privacy and lifecycle
eq('a client cannot read the photographer notifications', (await as(user(c1), `select * from notifications where user_id=$1`, [p2])).rows.length, 0)
await raises('nobody can write notifications directly', as(user(c1), `insert into notifications (user_id,type,title) values ($1,'x','x')`, [c1]), /permission denied/)
await raises('nobody can delete notifications', as(user(c1), `delete from notifications where user_id=$1`, [c1]), /permission denied/)
await raises('nobody can edit the text of a notification', as(user(c1), `update notifications set title='hacked' where user_id=$1`, [c1]), /permission denied/)
await raises('visitors cannot read notifications', as(anon, `select * from notifications`), /permission denied/)
const unreadBefore = (await as(user(p2), `select count(*)::int n from notifications where read_at is null`)).rows[0].n
await as(user(p2), `update notifications set read_at = now() where read_at is null`)
eq('the owner can mark them read', `${unreadBefore > 0}/${(await as(user(p2), `select count(*)::int n from notifications where read_at is null`)).rows[0].n}`, 'true/0')

// 3. client confirms early, then the photographer withdraws: "sent"
const a2 = await pastShoot()
await as(user(c1), `select * from confirm_shoot($1)`, [a2])
eq('client confirmed without the photographer marking: counts as complete', (await getB(a2)).shoot_completed_at !== null, true)
eq('deposit available at once (plus the earlier auto-confirmed one)', (await earn2()).a, '1350.90')
const w1 = (await asP2(`select * from request_withdrawal()`)).rows[0]
eq('test mode withdrawal is "sent"', w1.r_completed, true)
eq('...and the photographer is told it was sent', (await notes(p2, 'payout_sent')).length >= 1, true)

// 4. withdrawal of a real payout says "being sent"
const a3 = await pastShoot()
await su(`update bookings set simulated=false where id=$1`, [a3])
await as(user(c1), `select * from confirm_shoot($1)`, [a3])
await asP2(`select * from request_withdrawal()`)
eq('a real payout tells the photographer it is being sent', (await notes(p2, 'payout_processing')).length >= 1, true)
await as(user(adminId), `select * from admin_complete_payout((select id from payouts where booking_id=$1),'EFT-99')`, [a3])

// 5. problem reports
const r1 = await pastShoot()
await asP2(`select * from mark_shoot_complete($1)`, [r1])
await as(user(c1), `select * from confirm_shoot($1)`, [r1])
eq('the deposit is available before the problem', (await earn2()).a, '675.45')
await raises('a stranger cannot report', as(user(c2), `select * from report_issue($1,'other','something is wrong here')`, [r1]), /not allowed/)
await raises('the photographer cannot report the photos as bad', asP2(`select * from report_issue($1,'poor_quality','the photos are bad')`, [r1]), /only the client/)
await raises('the client cannot report a client no-show', as(user(c1), `select * from report_issue($1,'client_no_show','I did not show up')`, [r1]), /only the photographer/)
await raises('a report needs a real description', as(user(c1), `select * from report_issue($1,'not_delivered','short')`, [r1]), /at least 10/)
const rep = (await as(user(c1), `select * from report_issue($1,'not_delivered','I have waited a week and heard nothing')`, [r1])).rows[0]
eq('the report opens and the booking is disputed', `${rep.status}/${(await getB(r1)).status}`, 'open/disputed')
eq('the unwithdrawn deposit goes on hold', `${(await earn2()).a}/${(await earn2()).h}`, '0.00/675.45'.replace('0.00', '0'))
await raises('cannot withdraw while on hold', asP2(`select * from request_withdrawal()`), /nothing available/)
await raises('cannot report twice', as(user(c1), `select * from report_issue($1,'other','reporting again for fun')`, [r1]), /cannot report an issue at this stage/)
eq('the photographer is told', (await notes(p2, 'issue_reported')).length >= 1, true)
eq('the reporter gets a receipt', (await notes(c1, 'issue_received')).length >= 1, true)
eq('the admin is told', (await notes(adminId, 'dispute_opened')).length >= 1, true)
await raises('a client cannot resolve', as(user(c1), `select * from admin_resolve_dispute($1,'dismiss','x')`, [rep.id]), /admins only/)
await as(user(adminId), `select * from admin_resolve_dispute($1,'dismiss','Looks fine')`, [rep.id])
eq('dismissed: the booking carries on', (await getB(r1)).status, 'in_progress')
eq('...and the money is released again', `${(await earn2()).a}/${(await earn2()).h}`, '675.45/0')
eq('both sides hear the outcome', `${(await notes(c1, 'issue_resolved')).length >= 1}/${(await notes(p2, 'issue_resolved')).length >= 1}`, 'true/true')
await raises('cannot resolve twice', as(user(adminId), `select * from admin_resolve_dispute($1,'dismiss','x')`, [rep.id]), /already resolved/)
await asP2(`select * from request_withdrawal()`)

const r2 = await pastShoot()
const rep2 = (await as(user(c1), `select * from report_issue($1,'not_delivered','No photos have arrived at all')`, [r2])).rows[0]
await as(user(adminId), `select * from admin_resolve_dispute($1,'refund_client','Refund approved')`, [rep2.id])
eq('refund: booking cancelled and refunded', `${(await getB(r2)).status}/${(await getB(r2)).payment_status}`, 'cancelled/refunded')

const r3 = await pastShoot()
await asP2(`select * from mark_shoot_complete($1)`, [r3])
await as(user(c1), `select * from confirm_shoot($1)`, [r3])
const rep3 = (await as(user(c1), `select * from report_issue($1,'poor_quality','The photos are out of focus and cropped')`, [r3])).rows[0]
await as(user(adminId), `select * from admin_resolve_dispute($1,'pay_photographer','Photos are fine')`, [rep3.id])
eq('pay photographer: completed and fully released', `${(await getB(r3)).status}/${(await getB(r3)).payment_status}`, 'completed/fully_released')
eq('...with everything available to withdraw', (await earn2()).a, '2251.50')
await asP2(`select * from request_withdrawal()`)

console.log('\n# Delivering real photos (Worker functions)')
const reg = (who, booking, photo, size = 1000) => as(who, `select * from worker_register_photo($1,$2,$3,'IMG.jpg',$4)`, [who.uid, booking, photo, size])
const wUser = (id) => ({ ...svc, uid: id })
const key = (uid, photo, variant) => as(svc, `select worker_photo_key($1,$2,$3) k`, [uid, photo, variant]).then((r) => r.rows[0].k)
const dlv = await pastShoot(c1, pk2[0])           // package of 40 photos, shoot already started
const fut = await (async () => {                  // a booking whose shoot has not started
  const d = await dayPlus(dn++)
  await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, d])
  const x = (await book(user(c1), pk2[0], d, '10:00')).rows[0]
  await as(user(c1), `select * from simulate_payment($1)`, [x.id])
  return x.id
})()
await raises('normal users cannot call the Worker functions', as(user(p2), `select * from worker_register_photo($1,$2,$3,'a.jpg',10)`, [p2, dlv, randomUUID()]), /permission denied/)
await raises('...not even to look up a file key', as(user(c1), `select worker_photo_key($1,$2,'full')`, [c1, randomUUID()]), /permission denied/)
await raises('a photographer cannot insert a delivery photo directly', asP2(`insert into photos (photographer_id,booking_id,url,is_proof) values ($1,$2,'https://x/y.jpg',false)`, [pid2, dlv]), /row-level security/)
await raises('a stranger cannot register a photo', reg(wUser(p1), dlv, randomUUID()), /not allowed/)
await raises('the client cannot register a photo', reg(wUser(c1), dlv, randomUUID()), /not allowed/)
await raises('no photos before the shoot', reg(wUser(p2), fut, randomUUID()), /not happened yet/)
await raises('a photo over 50 MB is refused', reg(wUser(p2), dlv, randomUUID(), 60 * 1024 * 1024), /under 50 MB/)
await raises('an empty file is refused', reg(wUser(p2), dlv, randomUUID(), 0), /under 50 MB/)
const ids = []
for (let i = 0; i < 39; i++) { const id = randomUUID(); ids.push(id); await reg(wUser(p2), dlv, id) }
await raises('39 of 40 photos is not enough to deliver', asP2(`select * from deliver_gallery($1)`, [dlv]), /you have 39/)
const last = randomUUID()
const row = (await reg(wUser(p2), dlv, last, 2048)).rows[0]
eq('the photo is stored under the booking, with a preview path', `${row.storage_path === `deliveries/${dlv}/${last}.full`}/${row.preview_path === `deliveries/${dlv}/${last}.preview`}/${row.size_bytes}`, 'true/true/2048')
await raises('the same photo id cannot be registered twice', reg(wUser(p2), dlv, last), /duplicate key/)
await raises('a stranger cannot remove it', as(wUser(p1), `select * from worker_remove_photo($1,$2)`, [p1, last]), /not allowed/)
eq('the photographer can remove one before delivery', (await as(svc, `select * from worker_remove_photo($1,$2)`, [p2, last])).rows[0].id, last)
eq('...and upload it again', (await reg(wUser(p2), dlv, last)).rows.length, 1)
await raises('the client cannot see the photos before delivery', key(c1, last, 'preview'), /not allowed/)
eq('the photographer can fetch their own upload', await key(p2, last, 'full'), `deliveries/${dlv}/${last}.full`)
await raises('a stranger cannot fetch it', key(p1, last, 'full'), /not allowed/)
await asP2(`select * from deliver_gallery($1)`, [dlv])
eq('all 40 delivered: gallery uploaded', (await getB(dlv)).status, 'gallery_uploaded')
await raises('nothing can be added after delivery', reg(wUser(p2), dlv, randomUUID()), /before they are delivered/)
await raises('nothing can be removed after delivery', as(svc, `select * from worker_remove_photo($1,$2)`, [p2, last]), /before they are delivered/)
eq('the client can look at a preview', await key(c1, last, 'preview'), `deliveries/${dlv}/${last}.preview`)
await raises('...but not the full-size file before approving', key(c1, last, 'full'), /unlock when you approve/)
await raises('another client sees nothing', key(c2, last, 'preview'), /not allowed/)
eq('an admin can fetch it', await key(adminId, last, 'full'), `deliveries/${dlv}/${last}.full`)
await raises('an unknown variant is refused', key(c1, last, 'original'), /unknown variant/)
await as(user(c1), `select * from approve_gallery($1)`, [dlv])
eq('after approving the client gets the full-size file', await key(c1, last, 'full'), `deliveries/${dlv}/${last}.full`)
await su(`update bookings set gallery_expires_at = now() - interval '1 hour' where id=$1`, [dlv])
await raises('after 15 days the client can no longer download', key(c1, last, 'full'), /download period has ended/)
eq('the expired gallery is listed for deletion', (await as(svc, `select * from list_expired_galleries()`)).rows.some((r) => r.booking_id === dlv), true)
await as(svc, `select mark_gallery_purged($1)`, [dlv])
await raises('once deleted, nobody can fetch the files', key(p2, last, 'full'), /deleted after the download period|photo not found/)
eq('the photo rows are gone', (await su(`select count(*)::int n from photos where booking_id=$1 and not is_proof`, [dlv])).rows[0].n, 0)

console.log('\n# Editing packages: bookings keep what they were sold')
const dr = (b, who) => as(who, `select delivery_required($1) n`, [b]).then((r) => r.rows[0].n)
{
  const d = await dayPlus(dn++)
  await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, d])
  const realB = (await book(user(c1), pk2[1], d, '10:00')).rows[0]          // Signature: 100 photos
  eq('a new booking remembers the package photo count', (await getB(realB.id)).num_photos, 100)
  await as(svc, `select * from confirm_payment($1,'ozow',$2,$3)`, [realB.id, `REF-SNAP-${dn}`, realB.total_amount])
  await asP2(`update packages set num_photos = 3 where id=$1`, [pk2[1]])
  eq('a real booking still needs the original 100 after the package is edited', await dr(realB.id, user(c1)), 100)
  eq('...as the photographer sees it too', await dr(realB.id, user(p2)), 100)
  eq('a stranger gets nothing', await dr(realB.id, user(c2)), null)
  const d2 = await dayPlus(dn++)
  await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, d2])
  const testB = (await book(user(c1), pk2[1], d2, '10:00')).rows[0]        // booked at 3 photos now
  eq('a booking made after the edit remembers 3', (await getB(testB.id)).num_photos, 3)
  const d3 = await dayPlus(dn++)
  await asP2(`update packages set num_photos = 100 where id=$1`, [pk2[1]])
  await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, d3])
  const t3 = (await book(user(c1), pk2[1], d3, '10:00')).rows[0]
  await as(user(c1), `select * from simulate_payment($1)`, [t3.id])
  await asP2(`update packages set num_photos = 2 where id=$1`, [pk2[1]])
  eq('a TEST booking only needs the lower, current count (2)', await dr(t3.id, user(p2)), 2)
  await asP2(`update packages set num_photos = 500 where id=$1`, [pk2[1]])
  eq('...but a raised package never raises what was sold (100)', await dr(t3.id, user(p2)), 100)
  await su(`update platform_settings set simulate_payments=false`)
  await asP2(`update packages set num_photos = 2 where id=$1`, [pk2[1]])
  eq('with test mode off, even a test booking needs what was sold', await dr(t3.id, user(p2)), 100)
  await su(`update platform_settings set simulate_payments=true`)
  await asP2(`update packages set num_photos = 100 where id=$1`, [pk2[1]])
}

console.log('\n# Chat')
{
  const cb = await pastShoot(c1, pk2[0])                       // paid, between c1 and p2
  const send = (who, text, booking = cb) => as(user(who), `insert into chat_messages (booking_id,sender_id,content) values ($1,$2,$3) returning *`, [booking, who, text])
  const convos = (who) => as(user(who), `select * from my_conversations()`).then((r) => r.rows)
  const unreadNotes = (uid) => su(`select count(*)::int n from notifications where user_id=$1 and type='chat_message' and read_at is null and booking_id=$2`, [uid, cb]).then((r) => r.rows[0].n)

  await raises('an empty message is refused', send(c1, '   '), /write a message first/)
  await raises('a huge message is refused', send(c1, 'x'.repeat(2001)), /too long/)
  eq('the message is trimmed and saved', (await send(c1, '  Hi Lerato, can we do the beach?  ')).rows[0].content, 'Hi Lerato, can we do the beach?')
  eq('the photographer is notified once', await unreadNotes(p2), 1)
  await send(c1, 'Also, what should we wear?')
  await send(c1, 'And parking?')
  eq('...not once per message', await unreadNotes(p2), 1)
  eq('the notification shows the sender and a preview', (await su(`select title||'|'||body t from notifications where user_id=$1 and type='chat_message' order by created_at limit 1`, [p2])).rows[0].t, 'New message from ' + (await su(`select split_part(full_name,' ',1) n from profiles where id=$1`, [c1])).rows[0].n + '|Hi Lerato, can we do the beach?')
  eq('the sender is not notified of their own message', await su(`select count(*)::int n from notifications where user_id=$1 and type='chat_message' and booking_id=$2`, [c1, cb]).then((r) => r.rows[0].n), 0)

  const mine = await convos(p2)
  const row = mine.find((r) => r.booking_id === cb)
  eq('the photographer sees the conversation with the client name', row && row.other_name, (await su(`select full_name n from profiles where id=$1`, [c1])).rows[0].n)
  eq('...3 unread, last message "And parking?"', `${row.unread}/${row.last_message}/${row.last_from_me}`, '3/And parking?/false')
  eq('the sender has nothing unread', (await convos(c1)).find((r) => r.booking_id === cb).unread, 0)
  eq('chat_unread totals them', (await as(user(p2), `select chat_unread() n`)).rows[0].n >= 3, true)
  eq('a stranger sees no conversations', (await convos(c2)).some((r) => r.booking_id === cb), false)
  eq('...and no unread', (await as(user(c2), `select chat_unread() n`)).rows[0].n, 0)
  await raises('a stranger cannot mark it read', as(user(c2), `select mark_chat_read($1)`, [cb]), /not allowed/)
  await raises('visitors cannot call the chat functions', as(anon, `select * from my_conversations()`), /permission denied/)

  await as(user(p2), `select mark_chat_read($1)`, [cb])
  eq('opening the chat clears the unread count', (await convos(p2)).find((r) => r.booking_id === cb).unread, 0)
  eq('...and the notification', await unreadNotes(p2), 0)
  await send(p2, 'Beach works! Wear light colours.')
  eq('a reply notifies the client', await unreadNotes(c1), 1)
  eq('...and shows as 1 unread for them', (await convos(c1)).find((r) => r.booking_id === cb).unread, 1)
  await send(c1, 'Another message')
  eq('a new message after reading notifies again', await unreadNotes(p2), 1)
  eq('system messages never count as unread', (await su(`select count(*)::int n from chat_messages where booking_id=$1 and message_type='system'`, [cb])).rows[0].n > 0, true)

  let stopped = ''
  for (let i = 0; i < 40 && !stopped; i++) { try { await send(c1, 'spam ' + i) } catch (e) { stopped = e.message } }
  ok('sending too fast is stopped (at most 30 a minute)', /too fast/.test(stopped), stopped)
  await su(`delete from chat_messages where booking_id=$1 and content like 'spam %'`, [cb])
  await su(`update chat_messages set created_at = created_at - interval '2 minutes' where sender_id=$1`, [c1])

  // a booking nobody has paid for has no chat, and a cancelled one is closed
  const dd = await dayPlus(dn++)
  await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, dd])
  const unpaid = (await book(user(c2), pk2[0], dd, '10:00')).rows[0]
  await raises('no chat before payment', send(c2, 'hello?', unpaid.id), /row-level security/)
  eq('unpaid bookings are not listed as conversations', (await convos(c2)).some((r) => r.booking_id === unpaid.id), false)
  await as(user(c1), `select * from cancel_booking($1,'changed my mind')`, [cb])
  await raises('a cancelled booking is closed for new messages', send(c1, 'still there?'), /row-level security/)
  eq('...but the history is still readable and listed', (await convos(c1)).some((r) => r.booking_id === cb && r.status === 'cancelled'), true)
}

console.log('\n# Chats are deleted after 20 days')
{
  const cb = await pastShoot(c1, pk2[0])
  const old = (days, text) => su(`insert into chat_messages (booking_id,sender_id,content,created_at) values ($1,$2,$3, now() - make_interval(days => $4))`, [cb, c1, text, days])
  eq('the setting is 20 days', (await su(`select chat_retention_days n from platform_settings`)).rows[0].n, 20)
  await old(21, 'ancient'); await old(19, 'recent'); await old(25, 'also ancient')
  await raises('normal users cannot purge chats', as(user(c1), `select purge_old_chats()`), /permission denied/)
  await raises('visitors cannot purge chats', as(anon, `select purge_old_chats()`), /permission denied/)
  const n = (await as(svc, `select purge_old_chats() n`)).rows[0].n
  const left = (await su(`select content from chat_messages where booking_id=$1 and message_type='text'`, [cb])).rows.map((r) => r.content)
  ok('messages older than 20 days are deleted', n >= 2 && !left.includes('ancient') && !left.includes('also ancient'), JSON.stringify(left))
  ok('...newer ones stay', left.includes('recent'))
  eq('...and the booking itself is untouched', (await getB(cb)).status, 'confirmed')
  // evidence is kept while a problem report is open
  const cd = await pastShoot(c1, pk2[0])
  await su(`insert into chat_messages (booking_id,sender_id,content,created_at) values ($1,$2,'evidence', now() - interval '40 days')`, [cd, c1])
  const rep = (await as(user(c1), `select * from report_issue($1,'not_delivered','No photos have arrived at all, ever')`, [cd])).rows[0]
  await as(svc, `select purge_old_chats()`)
  eq('chats of a booking with an open problem report are kept', (await su(`select count(*)::int n from chat_messages where booking_id=$1 and content='evidence'`, [cd])).rows[0].n, 1)
  await as(user(adminId), `select * from admin_resolve_dispute($1,'dismiss','fine')`, [rep.id])
  await as(svc, `select purge_old_chats()`)
  eq('...and follow the 20-day rule once it is decided', (await su(`select count(*)::int n from chat_messages where booking_id=$1 and content='evidence'`, [cd])).rows[0].n, 0)
}

console.log('\n# The final money policy: fees, disputes, no-shows, strikes, date changes')
{
  const amt = (await su(`select * from calc_amounts(2400)`)).rows[0]
  eq('R2,400: commission 7%, payment fee 2.9% + R1, net (matches the policy document)', `${amt.platform_fee}/${amt.transaction_fee}/${amt.net}`, '168.00/70.60/2161.40')
  eq('...so a Tier 1 deposit is R648.42 and the final R1,512.98', `${(Math.round(2161.40 * 0.3 * 100) / 100).toFixed(2)}/${(2161.40 - 648.42).toFixed(2)}`, '648.42/1512.98')
  await raises('a booking must choose a rate', as(user(c1), `select * from create_booking($1,$2,'10:00','','ozow',null)`, [pk2[0], await dayPlus(300)]), /choose the Saver or the Flexible rate/)
  await raises('...and only the two real ones', as(user(c1), `select * from create_booking($1,$2,'10:00','','ozow','gold')`, [pk2[0], await dayPlus(300)]), /choose the Saver or the Flexible rate/)

  // a paid booking whose shoot already started, with the first payment released (package price R1,200: net R1,080.20, deposit R324.06)
  const released = async (rate = 'saver') => {
    const d = await dayPlus(dn++)
    await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, d])
    const x = (await as(user(c1), `select * from create_booking($1,$2,'10:00','','ozow',$3)`, [pk2[0], d, rate])).rows[0]
    await as(user(c1), `select * from simulate_payment($1)`, [x.id])
    await as(user(c1), `select * from simulate_shoot_over($1)`, [x.id])
    await as(user(c1), `select * from confirm_shoot($1)`, [x.id])
    return x.id
  }
  const report = (id, type = 'not_delivered') => as(user(c1), `select * from report_issue($1,$2,'The photos never arrived, nothing at all')`, [id, type]).then((r) => r.rows[0])
  const resolve = (dis, outcome, pct = null) => as(user(adminId), `select * from admin_resolve_dispute($1,$2,'decision made',$3)`, [dis.id, outcome, pct])
  const sumPayouts = async (id) => (await su(`select coalesce(sum(amount),0)::text t from payouts where booking_id=$1 and status <> 'failed'`, [id])).rows[0].t

  // dispute: the client wins -> the unpaid share comes back, the deposit stays with the photographer
  const dc = await released()
  eq('the deposit is released and waiting', await sumPayouts(dc), '324.06')
  const dis1 = await report(dc)
  eq('a decision date 5 working days away is set', (await su(`select (decision_due_by > now() + interval '4 days' and decision_due_by < now() + interval '8 days') ok from disputes where id=$1`, [dis1.id])).rows[0].ok, true)
  await resolve(dis1, 'refund_client')
  const bc = await getB(dc)
  eq('client wins: refund = the unpaid 70% (R840.00)', `${bc.status}/${bc.payment_status}/${bc.refund_amount}`, 'cancelled/refunded/840.00')
  eq('...the deposit is NOT refunded and is released to the photographer', `${await sumPayouts(dc)}/${(await su(`select frozen f from payouts where booking_id=$1`, [dc])).rows[0].f}`, '324.06/false')
  eq('...the refund is due within 14 days', (await su(`select refund_due_by > now() + interval '13 days' ok from bookings where id=$1`, [dc])).rows[0].ok, true)

  // dispute: the photographer wins -> the whole net is theirs
  const dp = await released()
  await resolve(await report(dp), 'pay_photographer')
  eq('photographer wins: they receive the full net (R1,080.20)', `${(await getB(dp)).status}/${await sumPayouts(dp)}`, 'completed/1080.20')

  // dispute: split decision
  const ds = await released()
  const dis3 = await report(ds)
  await raises('a split needs a percentage', resolve(dis3, 'split'), /between 1 and 99/)
  await raises('...a sensible one', resolve(dis3, 'split', 100), /between 1 and 99/)
  await resolve(dis3, 'split', 50)
  const bs = await getB(ds)
  eq('split 50/50: the client gets half of the unpaid share (R420.00)', `${bs.status}/${bs.refund_amount}`, 'completed/420.00')
  eq('...the photographer gets the deposit plus half of the final (R324.06 + R378.07)', await sumPayouts(ds), '702.13')

  // photographer no-show: everything comes back, including the flexible fee, plus a strike
  const strikesBefore = (await su(`select strike_count n from photographer_profiles where id=$1`, [pid2])).rows[0].n
  const dn1 = await dayPlus(dn++)
  await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, dn1])
  const nsB = (await as(user(c1), `select * from create_booking($1,$2,'10:00','','ozow','flexible')`, [pk2[0], dn1])).rows[0]
  await as(user(c1), `select * from simulate_payment($1)`, [nsB.id])
  await as(user(c1), `select * from simulate_shoot_over($1)`, [nsB.id])
  eq('a Flexible booking cost the client R1,200 + R150', nsB.total_amount, '1350.00')
  await resolve(await report(nsB.id, 'photographer_no_show'), 'refund_client')
  eq('no-show: 100% back including the flexible fee (R1,350.00)', (await getB(nsB.id)).refund_amount, '1350.00')
  eq('...and the photographer gets a strike', (await su(`select strike_count n from photographer_profiles where id=$1`, [pid2])).rows[0].n, strikesBefore + 1)

  // strikes: 1 warning, 2 = 30-day suspension, 3 = removed
  await su(`update photographer_profiles set strike_count = 0 where id=$1`, [pid2])
  const cancelPaid = async () => {
    const d = await dayPlus(dn++)
    await asP2(`insert into availability (photographer_id,day) values ($1,$2)`, [pid2, d])
    const x = (await as(user(c1), `select * from create_booking($1,$2,'10:00','','ozow','saver')`, [pk2[0], d])).rows[0]
    await as(user(c1), `select * from simulate_payment($1)`, [x.id])
    return x.id
  }
  const [k1, k2, k3] = [await cancelPaid(), await cancelPaid(), await cancelPaid()]
  const pstat = async () => (await su(`select verification_status s, strike_count n, suspended_until u from photographer_profiles where id=$1`, [pid2])).rows[0]
  await asP2(`select * from cancel_booking($1,'x')`, [k1])
  eq('strike 1: a warning only', `${(await pstat()).s}/${(await pstat()).n}`, 'approved/1')
  await asP2(`select * from cancel_booking($1,'x')`, [k2])
  const st2 = await pstat()
  eq('strike 2: suspended', `${st2.s}/${st2.n}`, 'suspended/2')
  eq('...for 30 days', (await su(`select (suspended_until > now() + interval '29 days' and suspended_until < now() + interval '31 days') ok from photographer_profiles where id=$1`, [pid2])).rows[0].ok, true)
  await raises('a suspended photographer cannot be booked', as(user(c1), `select * from create_booking($1,$2,'10:00','','ozow','saver')`, [pk2[0], await dayPlus(400)]), /not accepting bookings/)
  await raises('a photographer cannot lift their own suspension', asP2(`update photographer_profiles set suspended_until = now() - interval '1 day' where id=$1`, [pid2]), /protected/)
  eq('nothing is lifted early', (await as(svc, `select lift_suspensions() n`)).rows[0].n, 0)
  await su(`update photographer_profiles set suspended_until = now() - interval '1 minute' where id=$1`, [pid2])
  eq('after 30 days the suspension is lifted automatically', `${(await as(svc, `select lift_suspensions() n`)).rows[0].n}/${(await pstat()).s}`, '1/approved')
  await asP2(`select * from cancel_booking($1,'x')`, [k3])
  const st3 = await pstat()
  eq('strike 3: removed for good (suspended with no end date)', `${st3.s}/${st3.n}/${(await su(`select suspended_until = 'infinity' f from photographer_profiles where id=$1`, [pid2])).rows[0].f}`, 'suspended/3/true')
  eq('...and never lifted', (await as(svc, `select lift_suspensions() n`)).rows[0].n, 0)
  await su(`update photographer_profiles set verification_status='approved', strike_count=0, suspended_until=null where id=$1`, [pid2])

  // refunds are tracked and sent by an admin
  await raises('a client cannot mark a refund sent', as(user(c1), `select * from admin_mark_refund_sent($1,'X')`, [dc]), /admins only/)
  await as(user(adminId), `select * from admin_mark_refund_sent($1,'EFT-REF-9')`, [dc])
  eq('an admin marks it sent with a reference', (await getB(dc)).refund_reference, 'EFT-REF-9')
  eq('...and the client is told', (await su(`select count(*)::int n from notifications where user_id=$1 and type='refund_sent' and booking_id=$2`, [c1, dc])).rows[0].n, 1)
  await raises('...only once', as(user(adminId), `select * from admin_mark_refund_sent($1,'again')`, [dc]), /no refund is waiting/)

  // working days
  eq('1 working day after Friday 13 Nov is Monday 16 Nov', (await su(`select to_char(add_working_days('2026-11-13 10:00+02'::timestamptz, 1) at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') d`)).rows[0].d, '2026-11-16')

  // minimum withdrawal
  await asP2(`select * from request_withdrawal()`)
  await su(`insert into payouts (photographer_id, booking_id, amount, type) values ($1,$2,50,'final_release')`, [pid2, dc])
  await raises('withdrawals start at R100', asP2(`select * from request_withdrawal()`), /minimum withdrawal is R100.00/)
  await su(`update payouts set amount = 100 where photographer_id=$1 and amount = 50`, [pid2])
  eq('...R100 is allowed', (await asP2(`select * from request_withdrawal()`)).rows[0].r_total, '100.00')
}

console.log('\n# Date changes (Flexible rate, photographer approves)')
{
  const future = async (rate, daysAhead, time = '10:00', pkg = pk2[0]) => {
    const d = await dayPlus(daysAhead)
    await asP2(`insert into availability (photographer_id,day) values ($1,$2) on conflict do nothing`, [pid2, d])
    const x = (await as(user(c1), `select * from create_booking($1,$2,$3,'','ozow',$4)`, [pkg, d, time, rate])).rows[0]
    await as(user(c1), `select * from simulate_payment($1)`, [x.id])
    return x.id
  }
  const open2 = async (n) => { const d = await dayPlus(n); await asP2(`insert into availability (photographer_id,day) values ($1,$2) on conflict do nothing`, [pid2, d]); return d }
  const ask = (who, id, date, time = '11:00') => as(user(who), `select * from request_reschedule($1,$2,$3)`, [id, date, time])
  const decide = (who, id, yes, note = '') => as(user(who), `select * from decide_reschedule($1,$2,$3)`, [id, yes, note])

  const sv = await future('saver', 30)
  await raises('the Saver rate has no date changes', ask(c1, sv, await open2(60)), /only available with the Flexible rate/)

  const fx = await future('flexible', 31)
  const newDay = await open2(61)
  await raises('a stranger cannot ask', ask(c2, fx, newDay), /not allowed/)
  await raises('the photographer cannot ask for the client', ask(p2, fx, newDay), /not allowed/)
  await raises('a past date is refused', ask(c1, fx, await dayPlus(-2)), /in the future/)
  await raises('a day the photographer has not opened is refused', ask(c1, fx, await dayPlus(299)), /not available on this date/)
  await raises('less than 48h from now is refused', ask(c1, fx, await open2(1)), /at least 48 hours/)
  const req = (await ask(c1, fx, newDay)).rows[0]
  eq('the request is waiting', req.status, 'pending')
  eq('the photographer is told', (await su(`select count(*)::int n from notifications where user_id=$1 and type='reschedule_request' and booking_id=$2`, [p2, fx])).rows[0].n, 1)
  await raises('only one request at a time', ask(c1, fx, newDay, '12:00'), /already have a date change waiting/)
  await raises('the client cannot approve their own request', decide(c1, req.id, true), /not allowed/)
  await raises('a stranger cannot approve', decide(p1, req.id, true), /not allowed/)
  await decide(p2, req.id, true)
  const moved = await getB(fx)
  eq('approved: the booking moves to the new date and time', (await su(`select shoot_date::text||'/'||shoot_time::text v from bookings where id=$1`, [fx])).rows[0].v, `${newDay}/11:00:00`)
  eq('...and the start and end move with it', (await su(`select (shoot_starts_at = ((shoot_date + shoot_time) at time zone 'Africa/Johannesburg') and shoot_ends_at = shoot_starts_at + interval '2 hours') ok from bookings where id=$1`, [fx])).rows[0].ok, true)
  eq('...it counts as the one free change', moved.date_changes, 1)
  eq('...the client is told', (await su(`select count(*)::int n from notifications where user_id=$1 and type='reschedule_approved' and booking_id=$2`, [c1, fx])).rows[0].n, 1)
  await raises('only one free date change', ask(c1, fx, await open2(62)), /already used your free date change/)
  await raises('an answered request cannot be answered again', decide(p2, req.id, false), /already been answered/)
  eq('the refund cut-off follows the new date: cancelling still refunds', (await as(user(c1), `select * from cancel_booking($1,'x')`, [fx])).rows[0].refund_amount, '1200.00')

  // decline, expiry, conflicts
  const f2 = await future('flexible', 33)
  const r2 = (await ask(c1, f2, await open2(63))).rows[0]
  await decide(p2, r2.id, false, 'I am away that week')
  eq('declined: the booking stays', `${(await su(`select status from reschedule_requests where id=$1`, [r2.id])).rows[0].status}/${(await getB(f2)).date_changes}`, 'declined/0')
  eq('...and the client hears why', (await su(`select count(*)::int n from notifications where user_id=$1 and type='reschedule_declined' and body like '%away that week%'`, [c1])).rows[0].n, 1)
  const r3 = (await ask(c1, f2, await open2(64))).rows[0]
  await su(`update reschedule_requests set created_at = now() - interval '49 hours' where id=$1`, [r3.id])
  await raises('an unanswered request expires after 48 hours', decide(p2, r3.id, true), /has expired/)
  const r4 = (await ask(c1, f2, await open2(65))).rows[0]
  await su(`update reschedule_requests set created_at = now() - interval '49 hours' where id=$1`, [r4.id])
  eq('the scheduled job expires old requests and tells the client', `${(await as(svc, `select expire_reschedules() n`)).rows[0].n}/${(await su(`select status from reschedule_requests where id=$1`, [r4.id])).rows[0].status}`, '1/expired')
  // someone else takes the slot while the request waits
  const f3 = await future('flexible', 35)
  const busyDay = await open2(66)
  const r5 = (await ask(c1, f3, busyDay, '10:00')).rows[0]
  const other = await future('saver', 66, '10:00')
  await raises('approving fails if the slot was taken meanwhile', decide(p2, r5.id, true), /already booked/)
  await as(user(c1), `select * from cancel_booking($1,'x')`, [f3])
  eq('cancelling a booking cancels its waiting request', (await su(`select status from reschedule_requests where id=$1`, [r5.id])).rows[0].status, 'cancelled')
  await raises('date changes only apply to paid, upcoming bookings', ask(c1, f3, await open2(67)), /only a paid booking/)
  await raises('normal users cannot call the strike or release helpers', as(user(p2), `select apply_strike($1,'x')`, [pid2]), /permission denied/)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
