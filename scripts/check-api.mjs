// Sends every query shape the app uses to your real Supabase API (read-only, anonymous) and fails on any
// PostgREST *planning* error: ambiguous embeds (PGRST201), missing relationships (PGRST200), unknown columns, etc.
// Permission-denied / empty results are expected for an anonymous visitor and count as fine.
//   npm run check:api
import fs from 'node:fs'
import { APP_RPCS, APP_SELECTS } from '../src/lib/queries.js'

const env = { ...process.env }
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !(m[1] in env)) env[m[1]] = m[2]
  }
}
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (put them in .env).')
  process.exit(2)
}

let bad = 0
for (const [table, select] of APP_SELECTS) {
  const res = await fetch(`${url}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`, { headers: { apikey: key } })
  const body = await res.json().catch(() => null)
  const code = body && !Array.isArray(body) ? body.code : null
  const fine = res.ok || code === '42501'            // 42501 = permission denied (private table, as designed)
  console.log(`${fine ? 'ok  ' : 'FAIL'} ${table.padEnd(24)} ${select.length > 60 ? select.slice(0, 57) + '...' : select}${fine ? '' : `\n     -> HTTP ${res.status} ${code || ''} ${body?.message || ''}`}`)
  if (!fine) bad++
}
for (const [fn, args] of APP_RPCS) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  const body = await res.json().catch(() => null)
  const code = body && !Array.isArray(body) ? body.code : null
  const fine = res.ok || code === '42501'
  console.log(`${fine ? 'ok  ' : 'FAIL'} rpc ${fn.padEnd(20)} ${Object.keys(args).join(', ')}${fine ? '' : `\n     -> HTTP ${res.status} ${code || ''} ${body?.message || ''}`}`)
  if (!fine) bad++
}
console.log(bad ? `\n${bad} query shape(s) are broken.` : '\nAll query shapes are accepted by the API.')
process.exit(bad ? 1 : 0)
