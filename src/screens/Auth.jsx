import { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { signIn, signUp, sendPasswordReset } from '../lib/auth.js'
import { supabaseConfigured } from '../lib/supabase.js'
import { openReportCount } from '../lib/market.js'
import { AppNav } from './Client.jsx'
import { Button, Checkbox, Field, H1, Icon, Notice, Screen, Segmented, TopBar, inputCls } from '../ui.jsx'

const emailOk = (v) => /^\S+@\S+\.\S+$/.test(v.trim())

/** Where a freshly signed-in user should land. */
export function homeFor(auth) {
  if (auth.profile?.role === 'admin') return 'account'
  if (auth.profile?.role === 'photographer') {
    return ['incomplete', 'rejected'].includes(auth.photographer?.verification_status) ? 'onbProfile' : 'studio'
  }
  return 'home'
}

/* ---------- Sign in / create account ---------- */
export function Auth() {
  const { back, jump, auth, state, set } = useApp()
  const [mode, setMode] = useState('signup') // 'signin' | 'signup'
  const [role, setRole] = useState('client')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // Once the session arrives, move on.
  useEffect(() => {
    if (auth.status === 'in' && auth.profile) {
      const target = state.afterAuth && auth.profile.role === 'client' ? state.afterAuth : homeFor(auth)
      set({ afterAuth: null })
      jump(target)
    }
  }, [auth, jump, set, state.afterAuth])

  const signup = mode === 'signup'
  const valid = emailOk(email) && password.length >= 8 && (!signup || (fullName.trim().length > 1 && agree))

  const submit = async () => {
    setBusy(true); setError(''); setInfo('')
    const res = signup ? await signUp({ email, password, fullName, role }) : await signIn({ email, password })
    setBusy(false)
    if (res.error) return setError(res.error)
    if (res.needsConfirm) setInfo(`We sent a confirmation link to ${email.trim()}. Open it, then come back and sign in.`)
  }
  const forgot = async () => {
    if (!emailOk(email)) return setError('Enter your email above first.')
    setBusy(true); setError('')
    const res = await sendPasswordReset(email)
    setBusy(false)
    res.error ? setError(res.error) : setInfo('If that email has an account, a reset link is on its way.')
  }

  return (
    <Screen
      footer={
        <Button disabled={!valid || busy || !supabaseConfigured} onClick={submit}>
          {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
        </Button>
      }
    >
      <TopBar title={signup ? 'Create account' : 'Sign in'} onBack={back} />
      <div className="px-5 pb-4">
        <H1 className="mt-3">{signup ? <>Welcome to<br />SnapshotZA.</> : <>Good to see<br />you again.</>}</H1>
        <p className="mt-1 text-[13px] text-neutral-500">{signup ? 'Book with confidence, or get booked and paid safely.' : 'Sign in to your account.'}</p>

        <div className="mt-5"><Segmented value={mode} onChange={(m) => { setMode(m); setError(''); setInfo('') }} options={[{ value: 'signup', label: 'Create account' }, { value: 'signin', label: 'Sign in' }]} /></div>

        {!supabaseConfigured && (
          <Notice tone="cream" className="mt-4" title="Demo mode">Add your Supabase keys to <b>.env</b> to turn on real accounts.</Notice>
        )}

        <div className="mt-5 space-y-4">
          {signup && (
            <>
              <div>
                <span className="mb-1.5 block text-xs text-neutral-500">I want to…</span>
                <Segmented value={role} onChange={setRole} options={[{ value: 'client', label: 'Book a photographer' }, { value: 'photographer', label: 'Get booked' }]} />
              </div>
              <Field label="Full name"><input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" /></Field>
            </>
          )}
          <Field label="Email"><input className={inputCls} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
          <Field label="Password" hint={signup ? 'At least 8 characters.' : undefined}>
            <input className={inputCls} type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && valid && !busy && submit()} />
          </Field>
          {signup && (
            <Checkbox checked={agree} onChange={setAgree}>
              I agree to the Terms of Service and Privacy Policy{role === 'photographer' ? ', and I will keep my original photos after delivery' : ''}.
            </Checkbox>
          )}
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {info && <Notice className="mt-4" icon={<Icon.Check size={18} />} title="Check your email">{info}</Notice>}
        {!signup && <button onClick={forgot} className="mt-4 text-[13px] font-semibold text-link">Forgot your password?</button>}
      </div>
    </Screen>
  )
}

/* ---------- Account (client profile tab / admin landing) ---------- */
export function Account() {
  const { auth, signOut, jump, go, state } = useApp()
  const p = auth.profile
  const [openReports, setOpenReports] = useState(0)
  useEffect(() => {
    if (p?.role === 'admin') openReportCount().then(setOpenReports).catch(() => {})
  }, [p?.role])
  return (
    <Screen nav={<AppNav active="profile" />}>
      <div className="px-5 pt-3">
        <H1>Your account</H1>
        <div className="mt-5 rounded-2xl bg-surface p-4">
          <div className="text-[16px] font-semibold">{p?.full_name || 'Your name'}</div>
          <div className="text-[13px] text-neutral-500">{p?.email || auth.user?.email}</div>
          <span className="mt-2 inline-block rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold capitalize">{p?.role || 'client'}</span>
        </div>
        {p?.role === 'admin' && (
          <Notice className="mt-4" icon={<Icon.Shield size={18} />} title="Admin account">Review new photographers before they can take bookings.</Notice>
        )}
        <div className="mt-5 space-y-3">
          {p?.role === 'admin' && <Button onClick={() => go('adminList')}>Review photographers</Button>}
          {p?.role === 'admin' && <Button onClick={() => go('adminReports')}>{openReports > 0 ? `Problem reports (${openReports} open)` : 'Problem reports'}</Button>}
          <Button variant="soft" onClick={() => go('notifications')}>{state.unread > 0 ? `Notifications (${state.unread} new)` : 'Notifications'}</Button>
          <Button variant="soft" onClick={() => jump('home')}>Browse photographers</Button>
          <Button variant="soft" arrow={false} onClick={signOut}>Sign out</Button>
        </div>
      </div>
    </Screen>
  )
}
