import { supabase } from './supabase.js'
import { explain } from './studio.js'

const must = ({ error }, fallback) => {
  if (error) throw new Error(explain(error, fallback))
}

/** 'YYYY-MM-DD' without any timezone conversion (m is 0-based). */
export const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

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
    portfolio: (photos.data || []).map((x) => ({ id: x.id, src: x.thumbnail_url || x.url })),
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
/** Open days of an approved photographer in a range: { 'YYYY-MM-DD': isBooked }. */
export async function getAvailability(photographerId, from, to) {
  const res = await supabase.rpc('get_availability', { p_photographer: photographerId, p_from: from, p_to: to })
  must(res, 'Could not load the calendar.')
  const out = {}
  for (const r of res.data || []) out[r.day] = Boolean(r.is_booked)
  return out
}

const BOOKING_MESSAGES = [
  ['only clients can make bookings', 'Only client accounts can book. Sign out and use a client account to book a photographer.'],
  ['already booked', 'Someone just booked that time. Please pick another time or date.'],
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

/** The signed-in client's bookings, with the photographer and package names filled in. */
export async function myBookings(userId) {
  const res = await supabase.from('bookings')
    .select('id, booking_ref, status, payment_status, shoot_date, shoot_time, total_amount, created_at, photographer_id, package_id')
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

/* ----------------------------------- photographer: which days are open */
export async function loadMyCalendar(photographerId, from, to) {
  const [open, booked] = await Promise.all([
    supabase.from('availability').select('day').eq('photographer_id', photographerId).eq('is_open', true).gte('day', from).lte('day', to),
    supabase.from('bookings').select('shoot_date').eq('photographer_id', photographerId)
      .in('status', ['confirmed', 'in_progress', 'gallery_uploaded', 'disputed']).gte('shoot_date', from).lte('shoot_date', to),
  ])
  must(open, 'Could not load your calendar.')
  return { open: new Set((open.data || []).map((r) => r.day)), booked: new Set((booked.data || []).map((r) => r.shoot_date)) }
}
export async function setDays(photographerId, days, on) {
  if (!days.length) return
  if (on) {
    must(await supabase.from('availability').upsert(days.map((day) => ({ photographer_id: photographerId, day, is_open: true })), { onConflict: 'photographer_id,day' }))
  } else {
    must(await supabase.from('availability').delete().eq('photographer_id', photographerId).in('day', days))
  }
}
