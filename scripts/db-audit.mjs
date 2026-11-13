// Security audit of the database: loads every migration into an in-process Postgres and lists what is exposed.
//   node scripts/db-audit.mjs
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'

const db = new PGlite()
const src = fs.readFileSync('supabase/tests/db.test.mjs', 'utf8')
const start = src.indexOf('await db.exec(`') + 15
await db.exec(src.slice(start, src.indexOf('`)', start)))   // the same Supabase stand-ins the tests use
const dir = path.resolve('supabase/migrations')
for (const f of fs.readdirSync(dir).sort().filter((f) => !/storage/.test(f))) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))

const q = async (title, sql) => {
  const r = await db.query(sql)
  console.log(`\n## ${title} (${r.rows.length})`)
  for (const x of r.rows) console.log('  ' + Object.values(x).join(' | '))
  return r.rows
}
await q('tables WITHOUT row level security', `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)
await q('table privileges for anon', `select table_name, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
  where grantee='anon' and table_schema='public' group by 1 order by 1`)
await q('write privileges for authenticated', `select table_name, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
  where grantee='authenticated' and table_schema='public' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE') group by 1 order by 1`)
await q('functions anon can EXECUTE', `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || case when p.prosecdef then '  [DEFINER]' else '' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)
await q('SECURITY DEFINER functions signed-in users can EXECUTE', `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)
await q('SECURITY DEFINER functions without a fixed search_path', `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`)
await q('views', `select c.relname, coalesce(array_to_string(c.reloptions, ','), '(no options)') from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='v'`)
await q('policies', `select tablename, policyname, cmd, roles::text, left(regexp_replace(coalesce(qual,'') || ' / ' || coalesce(with_check,''), '\\s+', ' ', 'g'), 140)
  from pg_policies where schemaname='public' order by 1,2`)
