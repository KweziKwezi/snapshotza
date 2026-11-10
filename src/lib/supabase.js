import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True once .env has real values. The UI falls back to mock data until then. */
export const supabaseConfigured = Boolean(url && anonKey)

// The anon key is public by design: row level security (supabase/migrations) is what protects the data.
// NEVER put the service_role key in this project's front-end or .env.
export const supabase = supabaseConfigured
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null
