import { supabase } from './supabase.js'

export const BUCKET = { portfolio: 'portfolio', docs: 'verification-docs', avatars: 'avatars' }

/* ---------------------------------------------------------------- errors */
export function explain(error, fallback = 'Something went wrong. Please try again.') {
  const raw = (error && (error.message || String(error))) || ''
  const m = raw.toLowerCase()
  if (!raw) return fallback
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) return 'No connection. Check your internet and try again.'
  if (m.includes('bucket not found')) return 'Photo storage is not set up yet. (Owner: run migration 0005 in Supabase.)'
  if (m.includes('jwt expired') || m.includes('not authenticated')) return 'Your session expired. Please sign in again.'
  if (m.includes('row-level security') || m.includes('permission denied')) return 'You do not have permission to do that. Try signing out and in again.'
  if (m.includes('payload too large') || m.includes('exceeded the maximum')) return 'That file is too large. Try a smaller photo.'
  if (m.includes('duplicate key')) return 'That already exists.'
  if (m.includes('check constraint') && m.includes('account_number')) return 'Enter a valid account number (7–16 digits).'
  // Messages we raise ourselves in the database are already written for people; just capitalise.
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
const must = ({ error }, fallback) => {
  if (error) throw new Error(explain(error, fallback))
}

/* ------------------------------------------------------- image handling */
/** Resizes and re-encodes a photo in the browser (keeps uploads small on slow connections). */
export async function compressImage(file, { maxEdge = 2000, quality = 0.85 } = {}) {
  let bitmap
  try {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      bitmap = await createImageBitmap(file)
    }
  } catch {
    throw new Error('That photo format is not supported. Please use a JPG or PNG.')
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('Could not process that photo. Please try another one.')
  return blob
}

const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const publicUrl = (bucket, path) => supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
const thumbPath = (path) => path.replace(/\.jpg$/, '-t.jpg')

/* --------------------------------------------------------------- loading */
export const DEFAULT_PACKAGES = [
  { dbId: null, id: 'essential', name: 'Essential', price: 0, hours: 2, photos: 40, delivery: 7 },
  { dbId: null, id: 'signature', name: 'Signature', price: 0, hours: 4, photos: 100, delivery: 7 },
  { dbId: null, id: 'full', name: 'Full story', price: 0, hours: 8, photos: 250, delivery: 10 },
]

/** Reads everything a photographer has saved so far. Row Level Security limits this to their own rows. */
export async function loadStudio(photographerId) {
  const [photos, packages, bank, docs] = await Promise.all([
    supabase.from('photos').select('id, url, thumbnail_url, storage_path, is_cover, upload_order')
      .eq('photographer_id', photographerId).eq('is_portfolio', true).order('upload_order'),
    supabase.from('packages').select('*').eq('photographer_id', photographerId).eq('is_active', true).order('sort_order'),
    supabase.from('payout_accounts').select('*').eq('photographer_id', photographerId).maybeSingle(),
    supabase.from('verification_documents').select('doc_type, storage_path').eq('photographer_id', photographerId),
  ])
  return { photos: photos.data || [], packages: packages.data || [], bank: bank.data || null, docs: docs.data || [] }
}

/** Turns database rows into the shape the onboarding screens use. */
export function studioState(profile, photographer, data) {
  const docs = {}
  for (const d of data.docs) docs[d.doc_type] = { path: d.storage_path }
  const packages = data.packages.length
    ? data.packages.map((p) => ({
        dbId: p.id, id: p.id, name: p.name, price: Number(p.price_zar), hours: p.duration_hours, photos: p.num_photos, delivery: p.delivery_days,
      }))
    : DEFAULT_PACKAGES
  return {
    studio: {
      name: profile.full_name || '',
      city: photographer.location || '',
      specialties: photographer.specialties || [],
      bio: photographer.bio || '',
      photo: profile.profile_photo_url || null,
    },
    portfolio: data.photos.map((p) => ({ id: p.id, src: p.thumbnail_url || p.url, path: p.storage_path })),
    studioPackages: packages,
    bank: data.bank
      ? { bank: data.bank.bank_name, holder: data.bank.account_holder, account: data.bank.account_number, type: data.bank.account_type, branch: data.bank.branch_code }
      : null,
    docs,
    termsAccepted: Boolean(photographer.terms_accepted_at),
    completedBookings: photographer.total_bookings || 0,
    rating: Number(photographer.average_rating || 0),
  }
}

/* --------------------------------------------------------------- step 1 */
export async function saveProfile({ userId, photographerId, name, city, specialties, bio }) {
  must(await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', userId))
  must(await supabase.from('photographer_profiles')
    .update({ location: city.trim(), specialties, bio: bio.trim() }).eq('id', photographerId))
}

export async function uploadAvatar(userId, file) {
  const blob = await compressImage(file, { maxEdge: 600, quality: 0.85 })
  const path = `${userId}/avatar-${Date.now()}.jpg`
  must(await supabase.storage.from(BUCKET.avatars).upload(path, blob, { contentType: 'image/jpeg' }))
  const url = publicUrl(BUCKET.avatars, path)
  must(await supabase.from('profiles').update({ profile_photo_url: url }).eq('id', userId))
  return url
}

/* --------------------------------------------------------------- step 2 */
/** Uploads a full-size (<=2000px) and a small thumbnail (600px), then records the photo. */
export async function uploadPortfolioPhoto({ userId, photographerId, file, order, isCover }) {
  const [full, thumb] = [await compressImage(file, { maxEdge: 2000, quality: 0.82 }), await compressImage(file, { maxEdge: 600, quality: 0.75 })]
  const path = `${userId}/${newId()}.jpg`
  const storage = supabase.storage.from(BUCKET.portfolio)
  must(await storage.upload(path, full, { contentType: 'image/jpeg' }))
  const thumbUp = await storage.upload(thumbPath(path), thumb, { contentType: 'image/jpeg' })
  if (thumbUp.error) { await storage.remove([path]); must(thumbUp) }
  const url = publicUrl(BUCKET.portfolio, path)
  const thumbUrl = publicUrl(BUCKET.portfolio, thumbPath(path))
  const res = await supabase.from('photos')
    .insert({ photographer_id: photographerId, url, thumbnail_url: thumbUrl, storage_path: path, is_portfolio: true, is_cover: isCover, upload_order: order })
    .select('id').single()
  if (res.error) { await storage.remove([path, thumbPath(path)]); must(res) }
  return { id: res.data.id, src: thumbUrl, path }
}

export async function removePortfolioPhoto(photo) {
  must(await supabase.from('photos').delete().eq('id', photo.id))
  if (photo.path) await supabase.storage.from(BUCKET.portfolio).remove([photo.path, thumbPath(photo.path)])
}

/** Persists the order shown on screen; the first photo is the cover. */
export async function savePortfolioOrder(photos) {
  const results = await Promise.all(
    photos.map((p, i) => supabase.from('photos').update({ upload_order: i, is_cover: i === 0 }).eq('id', p.id)),
  )
  const failed = results.find((r) => r.error)
  if (failed) must(failed)
}

/* --------------------------------------------------------------- step 3 */
export async function savePackages(photographerId, list) {
  const saved = []
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    const row = {
      photographer_id: photographerId, name: p.name, price_zar: p.price, duration_hours: p.hours, num_photos: p.photos,
      delivery_days: p.delivery, is_popular: i === 1, is_active: true, sort_order: i, includes: ['Edited photos', 'Private online gallery'],
    }
    const res = p.dbId
      ? await supabase.from('packages').update(row).eq('id', p.dbId).select('id').single()
      : await supabase.from('packages').insert(row).select('id').single()
    must(res, 'Could not save your packages.')
    saved.push({ ...p, dbId: res.data.id, id: res.data.id })
  }
  return saved
}

/* --------------------------------------------------------------- step 4 */
export async function saveBank(photographerId, bank) {
  must(await supabase.from('payout_accounts').upsert({
    photographer_id: photographerId, bank_name: bank.bank, account_holder: bank.holder, account_number: bank.account,
    account_type: bank.type, branch_code: bank.branch,
  }, { onConflict: 'photographer_id' }))
}

/* --------------------------------------------------------------- step 5 */
export async function uploadDoc({ userId, photographerId, docType, file, previousPath }) {
  const blob = await compressImage(file, { maxEdge: 1800, quality: 0.85 })
  const path = `${userId}/${docType}-${Date.now()}.jpg`
  const storage = supabase.storage.from(BUCKET.docs)
  must(await storage.upload(path, blob, { contentType: 'image/jpeg' }))
  const res = await supabase.from('verification_documents')
    .upsert({ photographer_id: photographerId, doc_type: docType, storage_path: path }, { onConflict: 'photographer_id,doc_type' })
  if (res.error) { await storage.remove([path]); must(res) }
  if (previousPath) await storage.remove([previousPath])
  return path
}

export async function submitForVerification(photographerId) {
  must(await supabase.from('photographer_profiles').update({ terms_accepted_at: new Date().toISOString() }).eq('id', photographerId))
  must(await supabase.rpc('submit_for_verification'))
}

/* ------------------------------------------------------------ admin side */
export async function listPendingPhotographers() {
  const res = await supabase.from('photographer_profiles')
    .select('id, location, specialties, created_at, profiles(full_name, email, phone)')
    .eq('verification_status', 'pending_verification').order('created_at')
  must(res)
  return res.data || []
}

/** Everything an admin needs to decide, including short-lived links to the private ID photos. */
export async function loadReviewPack(photographerId) {
  const [pp, photos, packages, bank, docs] = await Promise.all([
    supabase.from('photographer_profiles').select('*, profiles(full_name, email, phone)').eq('id', photographerId).single(),
    supabase.from('photos').select('id, thumbnail_url, url').eq('photographer_id', photographerId).eq('is_portfolio', true).order('upload_order'),
    supabase.from('packages').select('*').eq('photographer_id', photographerId).order('sort_order'),
    supabase.from('payout_accounts').select('*').eq('photographer_id', photographerId).maybeSingle(),
    supabase.from('verification_documents').select('doc_type, storage_path').eq('photographer_id', photographerId),
  ])
  must(pp)
  const signed = []
  for (const d of docs.data || []) {
    const s = await supabase.storage.from(BUCKET.docs).createSignedUrl(d.storage_path, 600)
    signed.push({ type: d.doc_type, url: s.data?.signedUrl || null, error: s.error ? explain(s.error) : null })
  }
  return { photographer: pp.data, photos: photos.data || [], packages: packages.data || [], bank: bank.data || null, docs: signed }
}

export async function reviewPhotographer(photographerId, approve, note = '') {
  must(await supabase.rpc('admin_review_photographer', { p_photographer: photographerId, p_approve: approve, p_note: note }))
}
