import { supabase, supabaseConfigured } from './supabase.js'

const notConfigured = { error: 'The app is not connected to Supabase yet.' }

const friendly = (msg = '') => {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return 'Wrong email or password.'
  if (m.includes('email not confirmed')) return 'Please confirm your email first. Check your inbox (and spam).'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a few minutes and try again.'
  if (m.includes('password') && m.includes('characters')) return 'Your password must be at least 8 characters.'
  if (m.includes('already registered')) return 'That email already has an account. Try signing in.'
  return msg || 'Something went wrong. Please try again.'
}

export async function signUp({ email, password, fullName, role }) {
  if (!supabaseConfigured) return notConfigured
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    // role is only ever 'client' or 'photographer'; the database ignores anything else (admins are made by hand).
    options: { data: { full_name: fullName.trim(), role }, emailRedirectTo: window.location.origin },
  })
  if (error) return { error: friendly(error.message) }
  // Supabase hides whether an email exists: a repeat sign-up returns a user with no identities.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: 'That email already has an account. Try signing in.' }
  }
  return { needsConfirm: !data.session }
}

export async function signIn({ email, password }) {
  if (!supabaseConfigured) return notConfigured
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  return error ? { error: friendly(error.message) } : {}
}

export async function signOut() {
  if (supabaseConfigured) await supabase.auth.signOut()
}

export async function sendPasswordReset(email) {
  if (!supabaseConfigured) return notConfigured
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
  return error ? { error: friendly(error.message) } : {}
}

/** Loads the signed-in user's profile (and photographer status). Row Level Security limits this to their own rows. */
export async function loadAccount(userId) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, email, phone, full_name')
    .eq('id', userId)
    .maybeSingle()
  if (error) return { error: error.message }
  let photographer = null
  if (profile?.role === 'photographer') {
    const res = await supabase
      .from('photographer_profiles')
      .select('id, verification_status, tier, total_bookings')
      .eq('user_id', userId)
      .maybeSingle()
    photographer = res.data
  }
  return { profile, photographer }
}
