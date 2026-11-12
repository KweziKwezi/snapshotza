// Tests the Worker (src/worker.js) with a fake R2 bucket and a fake Supabase. Run: npm run test:worker
import worker, { purgeExpired, sniffImage } from '../src/worker.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + extra}`) }

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const TEXT = new TextEncoder().encode('<html>not a photo</html>')
const BOOKING = '11111111-1111-4111-8111-111111111111'
const PHOTO = '22222222-2222-4222-8222-222222222222'
const U_PHOTOG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function fakeR2() {
  const store = new Map()
  return {
    store, failPut: false,
    async put(k, v, o) { if (this.failPut) throw new Error('r2 down'); store.set(k, { body: v, httpMetadata: o?.httpMetadata, size: v.length }) },
    async get(k) { const o = store.get(k); return o ? { body: o.body, size: o.size, httpMetadata: o.httpMetadata } : null },
    async delete(keys) { for (const k of [].concat(keys)) store.delete(k) },
    async list({ prefix }) { return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false } },
  }
}

// A fake Supabase: tokens -> users, and scripted answers for the database functions.
let calls, dbAnswer
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if (u.endsWith('/auth/v1/user')) {
    const t = (init.headers.authorization || '').replace('Bearer ', '')
    return t === 'good-token' ? new Response(JSON.stringify({ id: U_PHOTOG }), { status: 200 }) : new Response('{}', { status: 401 })
  }
  const name = u.split('/rpc/')[1]
  const args = JSON.parse(init.body || '{}')
  calls.push({ name, args, key: init.headers.authorization })
  const a = dbAnswer[name]
  const r = typeof a === 'function' ? a(args) : a
  if (r instanceof Error) return new Response(JSON.stringify({ message: r.message, code: r.code }), { status: 400 })
  return new Response(JSON.stringify(r ?? null), { status: 200 })
}

const mkEnv = (extra = {}) => ({
  DELIVERIES: fakeR2(), SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'service-secret',
  ASSETS: { fetch: async () => new Response('the app') }, ...extra,
})
const req = (method, path, { token = 'good-token', body } = {}) =>
  new Request('https://site.test' + path, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body })
const form = (file, preview, name = 'IMG_1.jpg') => {
  const f = new FormData()
  if (file) f.set('file', new Blob([file]), name)
  if (preview) f.set('preview', new Blob([preview]), 'preview.jpg')
  return f
}
const reset = () => {
  calls = []
  dbAnswer = {
    worker_register_photo: (a) => ({ id: a.p_photo, storage_path: `deliveries/${a.p_booking}/${a.p_photo}.full`, preview_path: `deliveries/${a.p_booking}/${a.p_photo}.preview`, file_name: a.p_name, size_bytes: a.p_size }),
    worker_remove_photo: { id: PHOTO, storage_path: `deliveries/${BOOKING}/${PHOTO}.full`, preview_path: `deliveries/${BOOKING}/${PHOTO}.preview` },
    worker_photo_key: `deliveries/${BOOKING}/${PHOTO}.full`,
    list_expired_galleries: [], mark_gallery_purged: null,
  }
}
const err = (message, code) => Object.assign(new Error(message), { code })

console.log('# Basics')
reset()
let env = mkEnv()
ok('the app itself is served untouched', await (await worker.fetch(req('GET', '/bookings'), env)).text() === 'the app')
ok('no storage set up gives a clear 503', (await worker.fetch(req('GET', `/api/photos/${PHOTO}/preview`), mkEnv({ DELIVERIES: undefined }))).status === 503)
ok('no service key gives a clear 503', (await worker.fetch(req('GET', `/api/photos/${PHOTO}/preview`), mkEnv({ SUPABASE_SERVICE_KEY: undefined }))).status === 503)
ok('no sign-in token is refused', (await worker.fetch(req('GET', `/api/photos/${PHOTO}/preview`, { token: null }), env)).status === 401)
ok('a bad token is refused', (await worker.fetch(req('GET', `/api/photos/${PHOTO}/preview`, { token: 'forged' }), env)).status === 401)
ok('...and the database was never asked', calls.length === 0)
ok('unknown routes are 404', (await worker.fetch(req('GET', '/api/nothing'), env)).status === 404)
ok('image sniffing: jpeg, png, not text', sniffImage(JPEG) === 'image/jpeg' && sniffImage(PNG) === 'image/png' && sniffImage(TEXT) === null)

console.log('\n# Upload')
reset(); env = mkEnv()
let res = await worker.fetch(req('POST', `/api/deliveries/${BOOKING}`, { body: form(JPEG, JPEG) }), env)
let out = await res.json()
ok('a valid photo is accepted', res.status === 201 && /^[0-9a-f-]{36}$/.test(out.id), JSON.stringify(out))
ok('...both files are stored under the booking', env.DELIVERIES.store.has(`deliveries/${BOOKING}/${out.id}.full`) && env.DELIVERIES.store.has(`deliveries/${BOOKING}/${out.id}.preview`))
ok('...with the right content type', env.DELIVERIES.store.get(`deliveries/${BOOKING}/${out.id}.full`).httpMetadata.contentType === 'image/jpeg')
const reg = calls.find((c) => c.name === 'worker_register_photo')
ok('the database was told who is uploading (from the token, not the request)', reg.args.p_user === U_PHOTOG && reg.args.p_booking === BOOKING)
ok('the service key is only used towards the database', reg.key === 'Bearer service-secret')
ok('a PNG original is fine', (await worker.fetch(req('POST', `/api/deliveries/${BOOKING}`, { body: form(PNG, JPEG) }), env)).status === 201)

reset(); env = mkEnv()
res = await worker.fetch(req('POST', `/api/deliveries/${BOOKING}`, { body: form(TEXT, JPEG) }), env)
ok('a file that is not a photo is refused', res.status === 400 && /JPG, PNG or WebP/.test((await res.json()).error))
ok('...before the database or storage is touched', calls.length === 0 && env.DELIVERIES.store.size === 0)
res = await worker.fetch(req('POST', `/api/deliveries/${BOOKING}`, { body: form(JPEG, PNG) }), env)
ok('a preview that is not a JPG is refused', res.status === 400)
res = await worker.fetch(req('POST', `/api/deliveries/${BOOKING}`, { body: form(JPEG, null) }), env)
ok('a missing preview is refused', res.status === 400)
res = await worker.fetch(req('POST', '/api/deliveries/not-a-uuid', { body: form(JPEG, JPEG) }), env)
ok('a malformed booking id is not routed', res.status === 404)

reset(); env = mkEnv()
dbAnswer.worker_register_photo = err('not allowed', '42501')
res = await worker.fetch(req('POST', `/api/deliveries/${BOOKING}`, { body: form(JPEG, JPEG) }), env)
ok('when the database says no, the answer is 403 and nothing is stored', res.status === 403 && env.DELIVERIES.store.size === 0)
dbAnswer.worker_register_photo = err('the shoot has not happened yet')
res = await worker.fetch(req('POST', `/api/deliveries/${BOOKING}`, { body: form(JPEG, JPEG) }), env)
ok('the database\'s plain-language reason is passed on', res.status === 400 && (await res.json()).error === 'the shoot has not happened yet')

reset(); env = mkEnv(); env.DELIVERIES.failPut = true
res = await worker.fetch(req('POST', `/api/deliveries/${BOOKING}`, { body: form(JPEG, JPEG) }), env)
ok('if storage fails the upload is reported as failed', res.status === 502)
ok('...and the photo is forgotten so it cannot count towards delivery', calls.some((c) => c.name === 'worker_remove_photo'))

console.log('\n# Download')
reset(); env = mkEnv()
const fullKey = `deliveries/${BOOKING}/${PHOTO}.full`
env.DELIVERIES.store.set(fullKey, { body: JPEG, httpMetadata: { contentType: 'image/jpeg' }, size: JPEG.length })
res = await worker.fetch(req('GET', `/api/photos/${PHOTO}/full?download=1`), env)
ok('an allowed download returns the file', res.status === 200 && (await res.arrayBuffer()).byteLength === JPEG.length)
ok('...as an attachment, never cached', /attachment/.test(res.headers.get('content-disposition')) && /no-store/.test(res.headers.get('cache-control')))
ok('...and the database was asked about this user and variant', calls.some((c) => c.name === 'worker_photo_key' && c.args.p_user === U_PHOTOG && c.args.p_variant === 'full'))
res = await worker.fetch(req('GET', `/api/photos/${PHOTO}/preview`), env)
ok('a preview may be cached privately for an hour', /private, max-age=3600/.test(res.headers.get('cache-control')))
dbAnswer.worker_photo_key = err('full-size photos unlock when you approve the gallery')
res = await worker.fetch(req('GET', `/api/photos/${PHOTO}/full`), env)
ok('a refusal from the database is passed on and no file is sent', res.status === 400 && /unlock when you approve/.test((await res.json()).error))
dbAnswer.worker_photo_key = 'deliveries/gone.full'
ok('a file missing from storage is a 404', (await worker.fetch(req('GET', `/api/photos/${PHOTO}/full`), env)).status === 404)
ok('only preview and full exist as variants', (await worker.fetch(req('GET', `/api/photos/${PHOTO}/original`), env)).status === 404)

console.log('\n# Remove')
reset(); env = mkEnv()
env.DELIVERIES.store.set(fullKey, { body: JPEG, size: 1 }); env.DELIVERIES.store.set(fullKey.replace('.full', '.preview'), { body: JPEG, size: 1 })
res = await worker.fetch(req('DELETE', `/api/photos/${PHOTO}`), env)
ok('removing deletes both files', res.status === 200 && env.DELIVERIES.store.size === 0)
dbAnswer.worker_remove_photo = err('photos can only be removed before they are delivered')
env.DELIVERIES.store.set(fullKey, { body: JPEG, size: 1 })
res = await worker.fetch(req('DELETE', `/api/photos/${PHOTO}`), env)
ok('...but not once delivered (files stay)', res.status === 400 && env.DELIVERIES.store.has(fullKey))

console.log('\n# Deleting expired galleries')
reset(); env = mkEnv()
const OTHER = '33333333-3333-4333-8333-333333333333'
for (const k of [`deliveries/${BOOKING}/a.full`, `deliveries/${BOOKING}/a.preview`, `deliveries/${OTHER}/b.full`]) env.DELIVERIES.store.set(k, { body: JPEG, size: 1 })
dbAnswer.list_expired_galleries = [{ booking_id: BOOKING, storage_paths: [] }]
ok('one expired gallery is cleared', (await purgeExpired(env)) === 1)
ok('...only its own files are deleted', !env.DELIVERIES.store.has(`deliveries/${BOOKING}/a.full`) && !env.DELIVERIES.store.has(`deliveries/${BOOKING}/a.preview`) && env.DELIVERIES.store.has(`deliveries/${OTHER}/b.full`))
ok('...and the database is told afterwards', calls.some((c) => c.name === 'mark_gallery_purged' && c.args.p_booking === BOOKING))
reset(); env = mkEnv()
await worker.scheduled({}, env)
ok('the daily job with nothing expired does nothing', !calls.some((c) => c.name === 'mark_gallery_purged'))
await worker.scheduled({}, mkEnv({ SUPABASE_SERVICE_KEY: undefined }))
ok('the daily job without a key does not crash', true)

globalThis.fetch = realFetch
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
