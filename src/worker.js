// SnapshotZA Worker: the only thing that stores or serves delivery photos (Cloudflare R2).
//
//   POST   /api/deliveries/:bookingId     photographer uploads one edited photo (multipart: file, preview)
//   DELETE /api/photos/:photoId           photographer removes a photo before delivering
//   GET    /api/photos/:photoId/:variant  preview | full  (add ?download=1 to save it as a file)
//   cron                                  deletes galleries whose download period has ended
//
// The browser proves who it is with its Supabase sign-in token. The database decides what that person may do
// (supabase/migrations/0010); this file only moves bytes. Everything else is served from the built app.
//
// Needs: R2 binding DELIVERIES, vars SUPABASE_URL + SUPABASE_ANON_KEY, secret SUPABASE_SERVICE_KEY.

const MAX_FILE = 50 * 1024 * 1024
const MAX_PREVIEW = 5 * 1024 * 1024

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })

/** Looks at the first bytes, not at what the browser claims the file is. */
export function sniffImage(bytes) {
  const b = bytes
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}

async function whoIs(request, env) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')
  if (!m) return null
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${m[1]}` } })
  if (!res.ok) return null
  const u = await res.json()
  return u && u.id ? u.id : null
}

/** Calls a database function as the service role. Throws {status, message} with the database's own plain-language message. */
async function rpc(env, name, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!res.ok) {
    const err = new Error((data && data.message) || 'Something went wrong.')
    err.status = data && data.code === '42501' ? 403 : 400
    throw err
  }
  return data
}

const failure = (e) => json(e.status || 500, { error: e.status ? e.message : 'Something went wrong. Please try again.' })

async function upload(request, env, bookingId, userId) {
  let form
  try { form = await request.formData() } catch { return json(400, { error: 'Send the photo as a form upload.' }) }
  const file = form.get('file')
  const preview = form.get('preview')
  if (!file || typeof file === 'string' || !preview || typeof preview === 'string') return json(400, { error: 'A photo and its preview are both needed.' })
  if (file.size < 1 || file.size > MAX_FILE) return json(400, { error: 'Each photo must be under 50 MB.' })
  if (preview.size < 1 || preview.size > MAX_PREVIEW) return json(400, { error: 'The preview is too large.' })

  const fileBytes = new Uint8Array(await file.arrayBuffer())
  const previewBytes = new Uint8Array(await preview.arrayBuffer())
  const fileType = sniffImage(fileBytes)
  if (!fileType) return json(400, { error: 'Only JPG, PNG or WebP photos can be delivered.' })
  if (sniffImage(previewBytes) !== 'image/jpeg') return json(400, { error: 'The preview must be a JPG.' })

  const photoId = crypto.randomUUID()
  let row
  try {
    row = await rpc(env, 'worker_register_photo', { p_user: userId, p_booking: bookingId, p_photo: photoId, p_name: String(form.get('name') || file.name || 'photo'), p_size: file.size })
  } catch (e) { return failure(e) }

  try {
    await env.DELIVERIES.put(row.storage_path, fileBytes, { httpMetadata: { contentType: fileType } })
    await env.DELIVERIES.put(row.preview_path, previewBytes, { httpMetadata: { contentType: 'image/jpeg' } })
  } catch {
    // The files did not both arrive: forget the photo so it cannot count towards delivery.
    await env.DELIVERIES.delete([row.storage_path, row.preview_path]).catch(() => {})
    await rpc(env, 'worker_remove_photo', { p_user: userId, p_photo: photoId }).catch(() => {})
    return json(502, { error: 'The upload did not finish. Please try that photo again.' })
  }
  return json(201, { id: photoId, name: row.file_name, size: row.size_bytes })
}

async function remove(env, photoId, userId) {
  try {
    const row = await rpc(env, 'worker_remove_photo', { p_user: userId, p_photo: photoId })
    await env.DELIVERIES.delete([row.storage_path, row.preview_path].filter(Boolean))
    return json(200, { ok: true })
  } catch (e) { return failure(e) }
}

async function serve(env, photoId, variant, userId, download) {
  let k
  try {
    k = await rpc(env, 'worker_photo_key', { p_user: userId, p_photo: photoId, p_variant: variant })
  } catch (e) { return failure(e) }
  const obj = await env.DELIVERIES.get(k)
  if (!obj) return json(404, { error: 'That photo is no longer available.' })
  const headers = new Headers({
    'content-type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
    'cache-control': variant === 'preview' ? 'private, max-age=3600' : 'private, no-store',
    'x-content-type-options': 'nosniff',
  })
  if (obj.size != null) headers.set('content-length', String(obj.size))
  if (download) headers.set('content-disposition', `attachment; filename="${photoId}.${variant === 'full' ? 'jpg' : 'preview.jpg'}"`)
  return new Response(obj.body, { status: 200, headers })
}

/** Deletes every file of galleries whose download period is over, then tells the database. Returns how many galleries were cleared. */
export async function purgeExpired(env) {
  const due = (await rpc(env, 'list_expired_galleries', {})) || []
  let cleared = 0
  for (const g of due) {
    const prefix = `deliveries/${g.booking_id}/`
    let cursor
    do {
      const page = await env.DELIVERIES.list({ prefix, cursor, limit: 500 })
      if (page.objects.length) await env.DELIVERIES.delete(page.objects.map((o) => o.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    await rpc(env, 'mark_gallery_purged', { p_booking: g.booking_id })
    cleared++
  }
  return cleared
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    if (!env.DELIVERIES || !env.SUPABASE_SERVICE_KEY || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return json(503, { error: 'Photo storage is not set up yet.' })
    }
    const userId = await whoIs(request, env)
    if (!userId) return json(401, { error: 'Please sign in again.' })

    let m
    if (request.method === 'POST' && (m = /^\/api\/deliveries\/([0-9a-f-]{36})$/.exec(url.pathname))) return upload(request, env, m[1], userId)
    if (request.method === 'DELETE' && (m = /^\/api\/photos\/([0-9a-f-]{36})$/.exec(url.pathname))) return remove(env, m[1], userId)
    if (request.method === 'GET' && (m = /^\/api\/photos\/([0-9a-f-]{36})\/(preview|full)$/.exec(url.pathname))) {
      return serve(env, m[1], m[2], userId, url.searchParams.get('download') === '1')
    }
    return json(404, { error: 'Not found.' })
  },

  async scheduled(_event, env) {
    if (env.DELIVERIES && env.SUPABASE_SERVICE_KEY) await purgeExpired(env)
  },
}
