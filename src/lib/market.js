import { supabase } from './supabase.js'
import { explain } from './studio.js'

const must = ({ error }, fallback) => {
  if (error) throw new Error(explain(error, fallback))
}

/** 'YYYY-MM-DD' without any timezone conversion (m is 0-based). */
export const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const hm = (t) => (t ? String(t).slice(0, 5) : null)

/* ---------------------------------------------------------- test mode */
/** True while payments/payouts are simulated (platform_settings.simulate_payments). Defaults to false if unreadable. */
export async function getTestMode() {
  const res = await supabase.from('platform_settings').select('simulate_payments').maybeSingle()
  return Boolean(res.data?.simulate_payments)
}

/* ---------------------------------------------------------- browsing */
/** A row of public_photographers, in the shape the screens use. */
export function toCard(row) {
  const specialties = row.specialties || []
  return {
    id: row.id,
    name: row.full_name || 'Photographer',
    avatar: row.profile_photo_url,
    tone: 'warm',
    cover: row.cover_thumb_url || row.cover_url || null,
    city: row.location || '',
    specialties,
    style: specialties[0] || 'Photographer',
    tagline: specialties.length ? `${specialties.join(' & ')} photographer` : 'Photographer',
    bio: row.bio || '',
    rating: Number(row.average_rating) || 0,
    reviews: row.review_count || 0,
    from: Number(row.from_price) || 0,
    tier: row.tier,
  }
}

export async function listPhotographers() {
  const res = await supabase.from('public_photographers').select('*')
    .order('tier', { ascending: false }).order('average_rating', { ascending: false }).limit(60)
  must(res, 'Could not load photographers.')
  return (res.data || []).map(toCard)
}

export async function loadPhotographer(id) {
  const [p, photos, packages, reviews] = await Promise.all([
    supabase.from('public_photographers').select('*').eq('id', id).maybeSingle(),
    supabase.from('photos').select('id, url, thumbnail_url').eq('photographer_id', id).eq('is_portfolio', true).order('upload_order'),
    supabase.from('packages').select('*').eq('photographer_id', id).eq('is_active', true).order('sort_order'),
    supabase.from('reviews').select('id, rating, comment, created_at').eq('photographer_id', id).order('created_at', { ascending: false }).limit(5),
  ])
  must(p, 'Could not load this photographer.')
  if (!p.data) throw new Error('This photographer is not available right now.')
  return {
    p: toCard(p.data),
    portfolio: (photos.data || []).map((x) => ({ id: x.id, src: x.thumbnail_url || x.url, full: x.url })),
    packages: (packages.data || []).map((k) => ({
      id: k.id, name: k.name, price: Number(k.price_zar), hours: k.duration_hours, photos: k.num_photos, delivery: k.delivery_days, popular: k.is_popular,
    })),
    reviews: reviews.data || [],
  }
}

/* --------------------------------------------------------- favourites */
export async function loadFavorites() {
  const res = await supabase.from('favorites').select('photographer_id')
  must(res)
  return (res.data || []).map((r) => r.photographer_id)
}
export async function setFavorite(userId, photographerId, on) {
  if (on) {
    must(await supabase.from('favorites').upsert({ client_id: userId, photographer_id: photographerId }, { onConflict: 'client_id,photographer_id', ignoreDuplicates: true }))
  } else {
    must(await supabase.from('favorites').delete().eq('client_id', userId).eq('photographer_id', photographerId))
  }
}

/* ---------------------------------------------- client: dates & booking */
/** Open future days of an approved photographer: { 'YYYY-MM-DD': number of free start times for a shoot of `hours` }. */
export async function getOpenDays(photographerId, from, to, hours) {
  const res = await supabase.rpc('get_open_days', { p_photographer: photographerId, p_from: from, p_to: to, p_hours: hours })
  must(res, 'Could not load the calendar.')
  const out = {}
  for (const r of res.data || []) out[r.day] = r.free_slots
  return out
}

/** Start times ('HH:MM') still free on a day, honouring working hours and the gap between shoots. */
export async function getFreeSlots(photographerId, day, hours) {
  const res = await supabase.rpc('get_free_slots', { p_photographer: photographerId, p_day: day, p_hours: hours })
  must(res, 'Could not load the available times.')
  return (res.data || []).map(hm)
}

const BOOKING_MESSAGES = [
  ['only clients can make bookings', 'Only client accounts can book. Sign out and use a client account to book a photographer.'],
  ['already booked', 'Someone just booked around that time. Please pick another time or date.'],
  ['outside the photographer', 'That time is outside the photographer’s working hours. Please pick another time.'],
  ['not available on this date', 'That date was just taken or closed. Please pick another date.'],
  ['in the future', 'Please pick a date and time in the future.'],
  ['package not available', 'That package is no longer available.'],
  ['not accepting bookings', 'This photographer is not taking bookings right now.'],
  ['not authenticated', 'Please sign in to book.'],
]
export async function createBooking({ packageId, date, time, gateway }) {
  const res = await supabase.rpc('create_booking', {
    p_package_id: packageId, p_shoot_date: ymd(date.y, date.m, date.d), p_shoot_time: time, p_location: '', p_gateway: gateway,
  })
  if (res.error) {
    const raw = (res.error.message || '').toLowerCase()
    const hit = BOOKING_MESSAGES.find(([needle]) => raw.includes(needle))
    throw new Error(hit ? hit[1] : explain(res.error, 'Could not reserve that date.'))
  }
  return res.data
}

export async function cancelBooking(bookingId, reason = '') {
  must(await supabase.rpc('cancel_booking', { p_booking: bookingId, p_reason: reason }), 'Could not cancel the booking.')
}
export async function approveGallery(bookingId) {
  must(await supabase.rpc('approve_gallery', { p_booking: bookingId }), 'Could not approve the photos.')
}

/** The signed-in client's bookings, with the photographer and package names filled in. */
export async function myBookings(userId) {
  const res = await supabase.from('bookings')
    .select('id, booking_ref, status, payment_status, shoot_date, shoot_time, shoot_starts_at, shoot_ends_at, shoot_completed_at, shoot_confirmed_at, deposit_released_at, gallery_uploaded_at, total_amount, platform_fee, simulated, created_at, photographer_id, package_id')
    .eq('client_id', userId).order('created_at', { ascending: false }).limit(50)
  must(res, 'Could not load your bookings.')
  const rows = res.data || []
  if (!rows.length) return []
  const pids = [...new Set(rows.map((r) => r.photographer_id))]
  const kids = [...new Set(rows.map((r) => r.package_id))]
  const [people, packs] = await Promise.all([
    supabase.from('public_photographers').select('id, full_name, profile_photo_url').in('id', pids),
    supabase.from('packages').select('id, name').in('id', kids),
  ])
  const pm = Object.fromEntries((people.data || []).map((x) => [x.id, x]))
  const km = Object.fromEntries((packs.data || []).map((x) => [x.id, x]))
  return rows.map((r) => ({ ...r, photographerName: pm[r.photographer_id]?.full_name || 'Photographer', packageName: km[r.package_id]?.name || 'Package' }))
}

/* ---------------------------------------------------- TEST MODE actions */
export async function simulatePayment(bookingId) {
  const res = await supabase.rpc('simulate_payment', { p_booking: bookingId })
  must(res, 'Could not complete the test payment.')
  return res.data
}
/** TEST MODE: move the shoot into the past, so the real "mark complete" / "confirm" steps can be tried. */
export async function simulateShootOver(bookingId) {
  must(await supabase.rpc('simulate_shoot_over', { p_booking: bookingId }), 'Could not fast-forward the shoot.')
}
/** TEST MODE: skip the 24-hour confirmation wait (or the 48-hour photo review wait). */
export async function simulateSkipWait(bookingId) {
  must(await supabase.rpc('simulate_skip_wait', { p_booking: bookingId }), 'Could not skip the wait.')
}
export async function simulateDelivery(bookingId) {
  must(await supabase.rpc('simulate_delivery', { p_booking: bookingId }), 'Could not mark the photos as delivered.')
}

/* ----------------------------------------------- photographer: bookings */
/** Bookings a photographer has received (paid or later), newest shoot first, with client and package names. */
export async function studioBookings(photographerId) {
  const res = await supabase.from('bookings')
    .select('id, booking_ref, status, payment_status, shoot_date, shoot_time, shoot_starts_at, shoot_ends_at, shoot_completed_at, shoot_confirmed_at, deposit_released_at, gallery_uploaded_at, total_amount, platform_fee, transaction_fee, simulated, client_id, package_id')
    .eq('photographer_id', photographerId)
    .in('status', ['confirmed', 'in_progress', 'gallery_uploaded', 'completed', 'disputed'])
    .order('shoot_starts_at', { ascending: false }).limit(50)
  must(res, 'Could not load your bookings.')
  const rows = res.data || []
  if (!rows.length) return []
  const cids = [...new Set(rows.map((r) => r.client_id))]
  const kids = [...new Set(rows.map((r) => r.package_id))]
  const [clients, packs] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('id', cids),       // visible once a booking is paid
    supabase.from('packages').select('id, name').in('id', kids),
  ])
  const cm = Object.fromEntries((clients.data || []).map((x) => [x.id, x]))
  const km = Object.fromEntries((packs.data || []).map((x) => [x.id, x]))
  return rows.map((r) => ({
    ...r,
    clientName: cm[r.client_id]?.full_name || 'Client',
    packageName: km[r.package_id]?.name || 'Package',
    net: Number(r.total_amount) - Number(r.platform_fee) - Number(r.transaction_fee),
  }))
}

/* ----------------------------------------------- photographer: earnings */
export async function myEarnings() {
  const res = await supabase.rpc('my_earnings')
  must(res, 'Could not load your earnings.')
  const r = (Array.isArray(res.data) ? res.data[0] : res.data) || {}
  const n = (v) => Number(v) || 0
  return { available: n(r.available), onHold: n(r.on_hold), processing: n(r.processing), paidOut: n(r.paid_out), inEscrow: n(r.in_escrow), thisMonth: n(r.earned_this_month) }
}

export async function payoutHistory() {
  const res = await supabase.from('payouts')
    .select('id, booking_id, amount, type, status, frozen, bank_reference, created_at, completed_at, simulated')
    .order('created_at', { ascending: false }).limit(50)
  must(res, 'Could not load your payouts.')
  const rows = res.data || []
  if (!rows.length) return []
  const ids = [...new Set(rows.map((r) => r.booking_id))]
  const refs = await supabase.from('bookings').select('id, booking_ref').in('id', ids)
  const rm = Object.fromEntries((refs.data || []).map((x) => [x.id, x.booking_ref]))
  return rows.map((r) => ({ ...r, amount: Number(r.amount), bookingRef: rm[r.booking_id] || '' }))
}

export async function requestWithdrawal() {
  const res = await supabase.rpc('request_withdrawal')
  must(res, 'Could not start the withdrawal.')
  const r = (Array.isArray(res.data) ? res.data[0] : res.data) || {}
  return { total: Number(r.r_total) || 0, count: r.r_count || 0, reference: r.r_reference || null, completed: Boolean(r.r_completed) }
}

/* ----------------------------------- photographer: hours and open days */
export async function loadMyHours(photographerId) {
  const res = await supabase.from('photographer_profiles').select('work_start, work_end').eq('id', photographerId).maybeSingle()
  must(res, 'Could not load your hours.')
  return { start: hm(res.data?.work_start) || '08:00', end: hm(res.data?.work_end) || '18:00' }
}
export async function saveMyHours(photographerId, start, end) {
  must(await supabase.from('photographer_profiles').update({ work_start: start, work_end: end }).eq('id', photographerId), 'Could not save your hours.')
}

/** For the visible month: open days (Map day -> {start,end} override or null) and bookings per day (Map day -> count). */
export async function loadMyCalendar(photographerId, from, to) {
  const [open, booked] = await Promise.all([
    supabase.from('availability').select('day, start_time, end_time').eq('photographer_id', photographerId).eq('is_open', true).gte('day', from).lte('day', to),
    supabase.from('bookings').select('shoot_date').eq('photographer_id', photographerId)
      .in('status', ['confirmed', 'in_progress', 'gallery_uploaded', 'disputed']).gte('shoot_date', from).lte('shoot_date', to),
  ])
  must(open, 'Could not load your calendar.')
  const hours = new Map((open.data || []).map((r) => [r.day, r.start_time ? { start: hm(r.start_time), end: hm(r.end_time) } : null]))
  const counts = new Map()
  for (const r of booked.data || []) counts.set(r.shoot_date, (counts.get(r.shoot_date) || 0) + 1)
  return { open: hours, booked: counts }
}
export async function setDays(photographerId, days, on) {
  if (!days.length) return
  if (on) {
    // Only the columns we send are updated, so a day that already has custom hours keeps them.
    must(await supabase.from('availability').upsert(days.map((day) => ({ photographer_id: photographerId, day, is_open: true })), { onConflict: 'photographer_id,day' }))
  } else {
    must(await supabase.from('availability').delete().eq('photographer_id', photographerId).in('day', days))
  }
}
/** Custom hours for one open day. Pass null/null to go back to the usual hours. */
export async function setDayHours(photographerId, day, start, end) {
  must(await supabase.from('availability').upsert(
    { photographer_id: photographerId, day, is_open: true, start_time: start || null, end_time: end || null },
    { onConflict: 'photographer_id,day' },
  ), 'Could not save the hours for that day.')
}

/* ------------------------------------------- shoot confirmation & reports */
export async function markShootComplete(bookingId) {
  must(await supabase.rpc('mark_shoot_complete', { p_booking: bookingId }), 'Could not mark the shoot complete.')
}
export async function confirmShoot(bookingId) {
  must(await supabase.rpc('confirm_shoot', { p_booking: bookingId }), 'Could not confirm the shoot.')
}
export async function reportIssue(bookingId, type, description) {
  must(await supabase.rpc('report_issue', { p_booking: bookingId, p_type: type, p_description: description }), 'Could not send your report.')
}

/** The client's 24-hour window: when the shoot is confirmed automatically (null if the photographer has not marked it complete). */
export function autoConfirmAt(b, hours = 24) {
  return b.shoot_completed_at ? new Date(new Date(b.shoot_completed_at).getTime() + hours * 3600000) : null
}
/** "in 5 h 20 min", "in 40 min", or "any moment now". */
export function timeLeft(date, now = Date.now()) {
  const mins = Math.ceil((date.getTime() - now) / 60000)
  if (mins <= 0) return 'any moment now'
  const h = Math.floor(mins / 60)
  return h > 0 ? `in ${h} h ${mins % 60} min` : `in ${mins} min`
}

/* ------------------------------------------------------- notifications */
export async function listNotifications() {
  const res = await supabase.from('notifications').select('id, type, title, body, booking_id, created_at, read_at')
    .order('created_at', { ascending: false }).limit(50)
  must(res, 'Could not load your notifications.')
  return res.data || []
}
export async function unreadCount() {
  const res = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  return res.error ? 0 : res.count || 0
}
export async function markAllRead() {
  must(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null))
}

/* ------------------------------------------------- admin: problem reports */
export async function listReports(status = 'open') {
  const open = ['open', 'investigating']
  let q = supabase.from('disputes').select('id, booking_id, type, description, status, resolution, created_at, resolved_at, raised_by')
  q = status === 'open' ? q.in('status', open) : q.not('status', 'in', `(${open.join(',')})`)
  const res = await q.order('created_at', { ascending: status === 'open' }).limit(50)
  must(res, 'Could not load the reports.')
  const rows = res.data || []
  if (!rows.length) return []
  const refs = await supabase.from('bookings').select('id, booking_ref').in('id', [...new Set(rows.map((r) => r.booking_id))])
  const rm = Object.fromEntries((refs.data || []).map((x) => [x.id, x.booking_ref]))
  return rows.map((r) => ({ ...r, bookingRef: rm[r.booking_id] || '' }))
}
export async function openReportCount() {
  const res = await supabase.from('disputes').select('id', { count: 'exact', head: true }).in('status', ['open', 'investigating'])
  return res.error ? 0 : res.count || 0
}
/** Everything an admin needs to decide: the report, the booking, both people, and the money so far. */
export async function loadReport(id) {
  const d = await supabase.from('disputes').select('*').eq('id', id).maybeSingle()
  must(d, 'Could not load this report.')
  if (!d.data) throw new Error('This report was not found.')
  const b = await supabase.from('bookings').select('*').eq('id', d.data.booking_id).maybeSingle()
  must(b, 'Could not load the booking.')
  const bk = b.data
  const [client, photog, pay, pack] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, phone').eq('id', bk.client_id).maybeSingle(),
    supabase.from('photographer_profiles').select('id, user_id, strike_count, verification_status').eq('id', bk.photographer_id).maybeSingle(),
    supabase.from('payouts').select('id, amount, type, status, frozen, simulated').eq('booking_id', bk.id),
    supabase.from('packages').select('name').eq('id', bk.package_id).maybeSingle(),
  ])
  const pu = photog.data?.user_id
  const pprof = pu ? await supabase.from('profiles').select('id, full_name, email, phone').eq('id', pu).maybeSingle() : { data: null }
  return { report: d.data, booking: bk, client: client.data, photographer: { ...(photog.data || {}), ...(pprof.data || {}) }, payouts: pay.data || [], packageName: pack.data?.name || 'Package' }
}
export async function resolveReport(id, outcome, note) {
  must(await supabase.rpc('admin_resolve_dispute', { p_dispute: id, p_outcome: outcome, p_note: note }), 'Could not save the decision.')
}

/* ------------------------------------------- admin: real bank transfers */
/** Withdrawals photographers asked for that still need a real bank transfer, grouped by photographer. Test payouts never appear. */
export async function listTransfers() {
  const res = await supabase.from('payouts')
    .select('id, booking_id, photographer_id, amount, type, status, frozen, created_at')
    .eq('status', 'processing').eq('simulated', false).order('created_at', { ascending: true }).limit(200)
  must(res, 'Could not load the transfers.')
  const rows = res.data || []
  if (!rows.length) return []
  const pids = [...new Set(rows.map((r) => r.photographer_id))]
  const bids = [...new Set(rows.map((r) => r.booking_id))]
  const [ph, banks, refs] = await Promise.all([
    supabase.from('photographer_profiles').select('id, user_id').in('id', pids),
    supabase.from('payout_accounts').select('photographer_id, bank_name, account_holder, account_number, account_type, branch_code').in('photographer_id', pids),
    supabase.from('bookings').select('id, booking_ref').in('id', bids),
  ])
  const uids = (ph.data || []).map((x) => x.user_id)
  const names = uids.length ? await supabase.from('profiles').select('id, full_name').in('id', uids) : { data: [] }
  const nameOfUser = Object.fromEntries((names.data || []).map((x) => [x.id, x.full_name]))
  const userOf = Object.fromEntries((ph.data || []).map((x) => [x.id, x.user_id]))
  const bankOf = Object.fromEntries((banks.data || []).map((x) => [x.photographer_id, x]))
  const refOf = Object.fromEntries((refs.data || []).map((x) => [x.id, x.booking_ref]))
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.photographer_id)) {
      groups.set(r.photographer_id, { photographerId: r.photographer_id, name: nameOfUser[userOf[r.photographer_id]] || 'Photographer', bank: bankOf[r.photographer_id] || null, total: 0, payouts: [] })
    }
    const g = groups.get(r.photographer_id)
    g.total += Number(r.amount)
    g.payouts.push({ id: r.id, amount: Number(r.amount), bookingRef: refOf[r.booking_id] || '', type: r.type, frozen: r.frozen, created_at: r.created_at })
  }
  return [...groups.values()]
}
/** Marks each of these payouts as paid, with the bank's reference. Frozen ones are skipped by the database and reported back. */
export async function completeTransfers(payoutIds, reference) {
  const skipped = []
  for (const id of payoutIds) {
    const res = await supabase.rpc('admin_complete_payout', { p_payout: id, p_bank_reference: reference })
    if (res.error) {
      if (/on hold|already finished/i.test(res.error.message || '')) skipped.push(id)
      else must(res, 'Could not mark the payment as sent.')
    }
  }
  return skipped
}
