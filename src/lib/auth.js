import { supabase, supabaseConfigured } from './supabase.js'

const notConfigured = { error: 'The app is not connected to Supabase yet.' }

const friendly = (msg = '') => {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return 'Wrong email or password.'
  if (m.includes('email not confirmed')) return 'Please confirm your email first. Check your inbox (and spam).'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a few minutes and try again.'
  if (m.includes('password') && m.includes('characters')) return 'Your password must be at least 8 characters.'
  if (m.includes('already registered')) return 'We could not create that account. If you already have one, sign in instead.'
  return msg || 'Something went wrong. Please try again.'
}

export async function signUp({ email, password, fullName, phone, role }) {
  if (!supabaseConfigured) return notConfigured
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    // role is only ever 'client' or 'photographer'; the database ignores anything else (admins are made by hand).
    options: { data: { full_name: fullName.trim(), phone, role }, emailRedirectTo: window.location.origin },
  })
  if (error) return { error: friendly(error.message) }
  // A repeat sign-up returns a user with no identities. We answer exactly as for a new address, so nobody can use
  // this form to find out whether someone has an account.
  if (data.user && data.user.identities && data.user.identities.length === 0) return { needsConfirm: true }
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
      .select('id, verification_status, verification_note, tier, total_bookings, terms_accepted_at, strike_count, suspended_until')
      .eq('user_id', userId)
      .maybeSingle()
    photographer = res.data
  }
  return { profile, photographer }
}

/* ---------------------------------------------------------------- contact details */
const contactFriendly = (msg = '') => {
  const m = msg.toLowerCase()
  if (m.includes('profiles_phone_format') || m.includes('check constraint')) return 'Enter a South African phone number, e.g. 082 123 4567.'
  if (m.includes('cannot be removed')) return 'Your phone number cannot be removed, only changed.'
  if (m.includes('already been registered') || m.includes('already registered') || m.includes('email_exists')) return 'That email already belongs to another account.'
  if (m.includes('same') && m.includes('email')) return 'That is already your email address.'
  if (m.includes('invalid') && m.includes('email')) return 'Enter a valid email address.'
  return friendly(msg)
}

/** Saves name and phone (phone must already be in +27 format). */
export async function saveContact(userId, { fullName, phone }) {
  const { error } = await supabase.from('profiles').update({ full_name: fullName.trim(), phone }).eq('id', userId)
  return error ? { error: contactFriendly(error.message) } : {}
}

/** Starts an email change. Supabase emails a confirmation link; the email only changes once it is opened. */
export async function changeEmail(newEmail) {
  const { data, error } = await supabase.auth.updateUser({ email: newEmail.trim() }, { emailRedirectTo: window.location.origin })
  if (error) return { error: contactFriendly(error.message) }
  return { pending: data.user?.new_email || newEmail.trim() }
}

/* ------------------------------------------------- two-step sign-in (admins) */
// Admin powers only work in a session verified with an authenticator app (the database checks this too).
const mfaFriendly = (msg = '') => {
  const m = msg.toLowerCase()
  if (m.includes('invalid') || m.includes('code')) return 'That code is not right. Check the time on your phone and try the newest code.'
  return friendly(msg)
}
/** { level: 'aal1' | 'aal2', factors: verified authenticator apps } */
export async function mfaStatus() {
  if (!supabaseConfigured) return { level: 'aal1', factors: [] }
  const [aal, list] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()])
  return { level: aal.data?.currentLevel || 'aal1', factors: list.data?.totp || [] }
}
/** Starts adding an authenticator app: returns { id, qr, secret } to show. Unfinished earlier attempts are cleared. */
export async function startAuthenticator() {
  const list = await supabase.auth.mfa.listFactors()
  for (const f of list.data?.all || []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SnapshotZA admin ${new Date().toISOString().slice(0, 16)}` })
  if (error) return { error: mfaFriendly(error.message) }
  return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}
/** Checks a 6-digit code from the authenticator app; on success this session gets admin powers. */
export async function verifyAuthenticator(factorId, code) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: String(code).replace(/\D/g, '') })
  return error ? { error: mfaFriendly(error.message) } : {}
}
