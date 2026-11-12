import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import { AppNav } from './Client.jsx'
import * as api from '../lib/studio.js'
import * as market from '../lib/market.js'
import {
  BANKS, BOOKINGS_PER_TIER, MAX_TIER, MIN_PORTFOLIO_PHOTOS, SPECIALTIES, TIER_DEPOSIT_PCT, money, tierFor,
} from '../data.js'
import {
  Button, Checkbox, Field, H1, Icon, Notice, NotificationBell, Photo, Screen, Segmented, Stepper, TopBar, inputCls,
} from '../ui.jsx'

const maskAcc = (n = '') => '•••• ' + n.slice(-4)

/** True when a real (Supabase) photographer account is signed in. Otherwise these screens are the design demo. */
function useLive() {
  const { auth } = useApp()
  return auth.status === 'in' && auth.profile?.role === 'photographer' && Boolean(auth.photographer)
}

/** Runs an async action with busy + error state. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      return true
    } catch (e) {
      setError(api.explain(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}
const ErrorNote = ({ error, className = '' }) =>
  error ? <p role="alert" className={`rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700 ${className}`}>{error}</p> : null

function SignOutLink() {
  const { signOut } = useApp()
  return (
    <button onClick={signOut} className="mt-6 block w-full pb-4 text-center text-[13px] font-semibold text-neutral-500">
      Sign out
    </button>
  )
}

/* ---------- Photographer home: gate until approved, then the dashboard ---------- */
export function Studio() {
  const live = useLive()
  const { auth } = useApp()
  if (live && auth.photographer.verification_status !== 'approved') return <StudioGate />
  return <Dashboard live={live} />
}

function StudioGate() {
  const { auth, go, refreshAccount } = useApp()
  const { status, note } = { status: auth.photographer.verification_status, note: auth.photographer.verification_note }
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)
  const recheck = async () => {
    setBusy(true)
    await refreshAccount(auth.user, { force: true })
    setBusy(false)
    setChecked(true)
  }
  const name = (auth.profile?.full_name || '').split(' ')[0]

  if (status === 'pending_verification') {
    return (
      <Screen>
        <div className="px-5 pt-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cream text-amber-700"><Icon.Eye size={28} /></div>
          <H1 className="mt-5">Your profile is<br />under review.</H1>
          <p className="mt-2 text-[14px] leading-relaxed text-neutral-600">
            Thanks{name ? `, ${name}` : ''}. We check every photographer’s ID and bank details before they can take bookings. This usually takes up to 24 hours.
          </p>
          <Notice icon={<Icon.Lock size={18} />} className="mt-5" title="Your documents are private">
            Only our verification team can see your ID. They’re deleted shortly after review.
          </Notice>
          <div className="mt-6"><Button variant="soft" disabled={busy} onClick={recheck}>{busy ? 'Checking…' : 'Check my status'}</Button></div>
          {checked && !busy && <p className="mt-3 text-center text-[12.5px] text-neutral-500">Still under review. We’ll get to you soon.</p>}
          <SignOutLink />
        </div>
      </Screen>
    )
  }
  if (status === 'suspended') {
    return (
      <Screen>
        <div className="px-5 pt-6">
          <H1>Your studio<br />is paused.</H1>
          <p className="mt-2 text-[14px] text-neutral-600">Your account is not taking bookings right now. Please contact SnapshotZA support.</p>
          <SignOutLink />
        </div>
      </Screen>
    )
  }
  const rejected = status === 'rejected'
  return (
    <Screen footer={<Button onClick={() => go('onbProfile')}>{rejected ? 'Update my details' : 'Continue setup'}</Button>}>
      <div className="px-5 pt-6">
        <H1>{rejected ? <>We need a few<br />changes.</> : <>Finish setting up<br />your studio.</>}</H1>
        <p className="mt-2 text-[14px] text-neutral-600">
          {rejected ? 'Fix the points below and submit again.' : 'Clients can find and book you once your profile is complete and approved.'}
        </p>
        {rejected && <Notice tone="cream" className="mt-4" title="From our verification team">{note || 'Please check your details and documents.'}</Notice>}
        <SignOutLink />
      </div>
    </Screen>
  )
}

/* ---------- 8. Photographer dashboard ---------- */
function Dashboard({ live }) {
  const { go, jump, state, auth } = useApp()
  const [earn, setEarn] = useState(null)
  const [bookings, setBookings] = useState(null)
  useEffect(() => {
    if (!live) return undefined
    let off = false
    market.myEarnings().then((e) => { if (!off) setEarn(e) }).catch(() => {})
    market.studioBookings(auth.photographer.id).then((b) => { if (!off) setBookings(b) }).catch(() => { if (!off) setBookings([]) })
    return () => { off = true }
  }, [live, auth.photographer?.id])
  const active = (bookings || []).filter((b) => ['confirmed', 'in_progress', 'gallery_uploaded'].includes(b.status)).slice(0, 3)
  const [open, setOpen] = useState([18, 21])
  const booked = [21, 24]
  const week = [
    ['M', 16], ['T', 17], ['W', 18], ['T', 19], ['F', 20], ['S', 21], ['S', 22],
  ]
  const done = live ? auth.photographer.total_bookings || 0 : state.completedBookings
  const first = (live ? auth.profile.full_name : state.studio.name).split(' ')[0] || 'there'
  const tier = tierFor(done)
  const maxed = tier >= MAX_TIER
  const intoTier = done - (tier - 1) * BOOKINGS_PER_TIER
  const pct = maxed ? 100 : Math.round((intoTier / BOOKINGS_PER_TIER) * 100)
  const left = BOOKINGS_PER_TIER - intoTier

  return (
    <Screen nav={<AppNav active="profile" />}>
      <div className="px-5 pt-3">
        <div className="flex items-start justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Photographer studio</div>
          <NotificationBell count={auth.status === 'in' ? state.unread : 0} onClick={() => (auth.status === 'in' ? go('notifications') : go('auth'))} />
        </div>
        <H1 className="mt-1 text-[30px]">Morning, {first}.</H1>
        <p className="mt-1 text-[13px] text-neutral-500">Let’s make your next great shot happen.</p>

        <div className="mt-4 rounded-3xl bg-ink p-5 text-white">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Earned this month</div>
          <div className="mt-1 font-display text-[38px] font-extrabold">{money(live ? earn?.thisMonth || 0 : 18450)}</div>
          <div className="text-[12px] text-emerald-400">{live ? (earn?.thisMonth > 0 ? 'Released to you this month.' : 'Your first payment will show up here.') : '↑ 18% vs last month'}</div>
          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-[13px]">
            <span className="text-neutral-300">In escrow</span>
            <span className="font-semibold text-brand">{money(live ? earn?.inEscrow || 0 : 9000)}</span>
          </div>
        </div>

        {live && (
          <button onClick={() => go('earnings')} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-surface p-4 text-left">
            <Icon.Bank size={22} />
            <div className="flex-1">
              <div className="text-[14px] font-semibold">Available to withdraw</div>
              <div className="text-[12px] text-neutral-500">Earnings & withdrawals</div>
            </div>
            <div className="font-display text-[18px] font-bold">{money(earn?.available || 0)}</div>
            <Icon.Chevron size={18} />
          </button>
        )}

        <div className="mt-4 rounded-2xl border border-[#f1e3a0] bg-cream p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">Tier {tier} · {TIER_DEPOSIT_PCT[tier]}% paid 24h after each shoot</div>
          <div className="mt-1 font-display text-[19px] font-bold">{maxed ? 'You’re at the top tier.' : 'Your next level is close.'}</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#efe6bd]"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
          <div className="mt-2 text-[12px] text-neutral-700">
            {maxed ? `${done} completed bookings` : `${intoTier} / ${BOOKINGS_PER_TIER} bookings to Tier ${tier + 1}`}
          </div>
          <p className="mt-1 text-[12px] text-neutral-600">
            {maxed ? 'Half of every booking lands within 24 hours of the shoot. The rest follows delivery.' : `${left} more completed ${left === 1 ? 'booking' : 'bookings'} lifts your early payout from ${TIER_DEPOSIT_PCT[tier]}% to ${TIER_DEPOSIT_PCT[tier + 1]}%. The rest is paid after you deliver your photos.`}
          </p>
        </div>

        {!state.bank && (
          <button onClick={() => go('payouts')} className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-info p-4 text-left">
            <Icon.Bank size={22} className="text-link" />
            <div className="flex-1"><div className="text-[13px] font-semibold">Add your bank details</div><div className="text-[12px] text-neutral-600">You can’t be paid until this is done.</div></div>
            <Icon.Chevron size={18} />
          </button>
        )}

        <div className="mb-3 mt-6 flex items-center justify-between">
          <h2 className="font-display text-[18px] font-bold">{live ? 'Active bookings' : 'Upcoming bookings'}</h2>
          <button onClick={() => live && jump('bookings')} className="text-[13px] font-semibold text-link">View all</button>
        </div>
        {live ? (
          bookings === null ? (
            <p className="text-[13px] text-neutral-500">Loading…</p>
          ) : active.length === 0 ? (
            <div className="rounded-2xl bg-surface p-4 text-[13px] text-neutral-600">{bookings.length === 0 ? 'No bookings yet. Your studio is approved and ready.' : 'No active bookings right now.'}</div>
          ) : (
            <div className="space-y-3">
              {active.map((b) => {
                const d = new Date(`${b.shoot_date}T00:00:00`)
                return (
                  <button key={b.id} onClick={() => jump('bookings')} className="flex w-full items-center gap-4 rounded-2xl bg-surface p-3 text-left">
                    <div className="flex h-14 w-14 flex-col items-center justify-center rounded-xl bg-white"><span className="font-display text-[20px] font-bold leading-none">{d.getDate()}</span><span className="text-[10px] uppercase text-neutral-500">{d.toLocaleString('en', { month: 'short' })}</span></div>
                    <div className="flex-1"><div className="text-[14px] font-semibold">{b.clientName}</div><div className="text-[11.5px] text-neutral-500">{b.packageName} · {String(b.shoot_time).slice(0, 5)}</div></div>
                    <span className="self-end text-[11.5px] font-semibold text-link">You earn {money(b.net)}</span>
                  </button>
                )
              })}
            </div>
          )
        ) : (
          <div className="space-y-3">
            {[
              ['21', 'Kayla & James', 'Wedding · Signature · 14:00', 4500],
              ['24', 'Sipho Ndlovu', 'Corporate · Half day · 09:00', 4500],
            ].map(([d, n, sub, amt]) => (
              <div key={d} className="flex items-center gap-4 rounded-2xl bg-surface p-3">
                <div className="flex h-14 w-14 flex-col items-center justify-center rounded-xl bg-white"><span className="font-display text-[20px] font-bold leading-none">{d}</span><span className="text-[10px] text-neutral-500">NOV</span></div>
                <div className="flex-1"><div className="text-[14px] font-semibold">{n}</div><div className="text-[11.5px] text-neutral-500">{sub}</div></div>
                <span className="self-end text-[11.5px] font-semibold text-link">Paid · {money(amt)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mb-3 mt-6 flex items-center justify-between">
          <h2 className="font-display text-[18px] font-bold">Your availability</h2>
          {!live && <button className="text-[13px] font-semibold text-link">Edit calendar</button>}
        </div>
        {live ? (
          <button onClick={() => go('availability')} className="flex w-full items-center gap-3 rounded-2xl bg-surface p-4 text-left">
            <Icon.Calendar size={22} />
            <div className="flex-1">
              <div className="text-[14px] font-semibold">Set your available days</div>
              <div className="text-[12px] text-neutral-500">Clients can only book days you’ve opened.</div>
            </div>
            <Icon.Chevron size={18} />
          </button>
        ) : (
          <div className="flex gap-2">
            {week.map(([l, n]) => {
              const isBooked = booked.includes(n)
              const isOpen = open.includes(n)
              return (
                <button
                  key={n}
                  disabled={isBooked}
                  onClick={() => setOpen((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o, n]))}
                  className={`flex h-[72px] flex-1 flex-col items-center justify-center gap-1 rounded-xl ${isBooked ? 'bg-ink text-white' : 'bg-surface'}`}
                >
                  <span className={`text-[11px] ${isBooked ? 'text-neutral-300' : 'text-neutral-500'}`}>{l}</span>
                  <span className="text-[15px] font-semibold">{n}</span>
                  <span className={`h-1 w-1 rounded-full ${isBooked || isOpen ? 'bg-brand' : 'bg-transparent'}`} />
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-4 space-y-2 text-[12.5px]">
          {live || state.verification === 'verified' ? (
            <div className="flex items-center gap-2 text-link"><Icon.Check size={15} /> Identity verified · Your studio is ready to book.</div>
          ) : (
            <div className="flex items-center gap-2 text-amber-700"><Icon.Eye size={15} /> Identity under review · Usually within 24 hours.</div>
          )}
          {state.bank && (
            <button onClick={() => go('payouts')} className="flex items-center gap-2 text-link">
              <Icon.Bank size={15} /> Payouts to {state.bank.bank} {maskAcc(state.bank.account)} · Edit
            </button>
          )}
        </div>
        {live && <SignOutLink />}
        {!live && <div className="pb-5" />}
      </div>
    </Screen>
  )
}

/* ---------- onboarding shell ---------- */
const STEP_LABELS = ['Profile', 'Portfolio', 'Packages', 'Payouts', 'Verification']
function Onb({ step, children, footer }) {
  const { back, jump } = useApp()
  return (
    <Screen footer={footer}>
      <TopBar title="Create your studio" onBack={back} right={<button onClick={() => jump('studio')} className="text-[13px] font-normal text-neutral-500">Save & exit</button>} />
      <Stepper steps={5} current={step} left={`0${step} / 05`} right={STEP_LABELS[step - 1].toUpperCase()} />
      <div className="px-5 pb-4">{children}</div>
    </Screen>
  )
}

/* ---------- 9. Step 1 — Profile ---------- */
export function OnbProfile() {
  const { go, set, state, auth } = useApp()
  const live = useLive()
  const s = state.studio
  const fileRef = useRef(null)
  const { busy, error, run } = useAction()
  const upd = (k) => (e) => set({ studio: { ...s, [k]: e.target.value } })
  const toggle = (c) =>
    set({ studio: { ...s, specialties: s.specialties.includes(c) ? s.specialties.filter((x) => x !== c) : [...s.specialties, c] } })
  const valid = s.name.trim() && s.city.trim() && s.specialties.length > 0 && (!live || s.bio.trim())

  const next = async () => {
    if (!live) return go('onbPortfolio')
    const ok = await run(() =>
      api.saveProfile({ userId: auth.user.id, photographerId: auth.photographer.id, name: s.name, city: s.city, specialties: s.specialties, bio: s.bio }),
    )
    if (ok) go('onbPortfolio')
  }
  const pickPhoto = async (file) => {
    if (!file) return
    if (!live) return set({ studio: { ...s, photo: URL.createObjectURL(file) } })
    await run(async () => {
      const url = await api.uploadAvatar(auth.user.id, file)
      set((st) => ({ studio: { ...st.studio, photo: url } }))
    })
  }

  return (
    <Onb
      step={1}
      footer={
        <>
          <ErrorNote error={error} className="mb-2" />
          <Button disabled={!valid || busy} onClick={next}>{busy ? 'Saving…' : 'Continue to portfolio'}</Button>
        </>
      }
    >
      <H1 className="mt-5">Put a face to<br />your craft.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Build a profile clients can connect with.</p>
      <div className="mt-5 flex items-center gap-4">
        <Photo src={s.photo || (live ? null : '/photos/thabo.jpg')} tone="warm" label={s.name.split(' ').map((w) => w[0]).slice(0, 2).join('')} className="h-[72px] w-[72px] shrink-0 rounded-full" />
        <div>
          <div className="text-[14px] font-semibold">Looking sharp, {s.name.split(' ')[0] || 'there'}.</div>
          <button onClick={() => fileRef.current.click()} disabled={busy} className="text-[13px] text-link">{s.photo ? 'Change profile photo' : 'Add a profile photo'}</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files[0]); e.target.value = '' }} />
        </div>
      </div>
      <div className="mt-5 space-y-4">
        <Field label="Full name"><input className={inputCls} value={s.name} onChange={upd('name')} autoComplete="name" /></Field>
        <Field label="Based in"><input className={inputCls} value={s.city} onChange={upd('city')} placeholder="e.g. Cape Town, Western Cape" /></Field>
        <div>
          <span className="mb-1.5 block text-xs text-neutral-500">What do you shoot? (pick all that apply)</span>
          <div className="flex flex-wrap gap-2">
            {SPECIALTIES.map((c) => {
              const on = s.specialties.includes(c)
              return (
                <button key={c} onClick={() => toggle(c)} aria-pressed={on} className={`h-9 rounded-xl px-4 text-[13px] font-medium ${on ? 'bg-ink text-white' : 'bg-surface text-neutral-700'}`}>{c}</button>
              )
            })}
          </div>
        </div>
        <Field label="Your bio"><textarea rows={3} maxLength={200} className={`${inputCls} h-auto resize-none py-3`} value={s.bio} onChange={upd('bio')} placeholder="Tell clients about your style in a sentence or two." /></Field>
      </div>
    </Onb>
  )
}

/* ---------- 10. Step 2 — Portfolio ---------- */
const MAX_PHOTOS = 12
const TONE_CYCLE = ['green', 'dusk', 'cream', 'warm']
export function OnbPortfolio() {
  const { go, set, state, auth } = useApp()
  const live = useLive()
  const photos = state.portfolio
  const fileRef = useRef(null)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState(null)
  const { busy, error, run } = useAction()
  const working = busy || Boolean(progress)

  const add = async (files) => {
    const room = MAX_PHOTOS - photos.length
    let problem = files.length > room ? `You can add up to ${MAX_PHOTOS} photos.` : ''
    const ok = files.slice(0, room).filter((f) => {
      if (!/^image\/(jpeg|png)$/.test(f.type)) { problem = 'Only JPG or PNG photos are allowed.'; return false }
      if (f.size > 20 * 1024 * 1024) { problem = 'Each photo must be 20 MB or smaller.'; return false }
      return true
    })
    if (!live) {
      setErr(problem)
      return set({ portfolio: [...photos, ...ok.map((f) => ({ id: Date.now() + Math.random(), tone: 'sand', src: URL.createObjectURL(f) }))] })
    }
    let list = [...photos]
    for (let i = 0; i < ok.length; i++) {
      setProgress({ done: i, total: ok.length })
      try {
        const row = await api.uploadPortfolioPhoto({ userId: auth.user.id, photographerId: auth.photographer.id, file: ok[i], order: list.length, isCover: list.length === 0 })
        list = [...list, row]
        set({ portfolio: list })
      } catch (e) {
        problem = api.explain(e)
        break
      }
    }
    setProgress(null)
    setErr(problem)
  }
  const makeCover = async (id) => {
    if (photos[0]?.id === id) return
    const next = [photos.find((p) => p.id === id), ...photos.filter((p) => p.id !== id)]
    set({ portfolio: next })
    if (live) await run(() => api.savePortfolioOrder(next))
  }
  const remove = async (id) => {
    const photo = photos.find((p) => p.id === id)
    const rest = photos.filter((p) => p.id !== id)
    if (!live) return set({ portfolio: rest })
    const ok = await run(async () => {
      await api.removePortfolioPhoto(photo)
      if (photos[0]?.id === id && rest.length) await api.savePortfolioOrder(rest)
    })
    if (ok) set({ portfolio: rest })
  }

  return (
    <Onb
      step={2}
      footer={
        <>
          <ErrorNote error={error} className="mb-2" />
          <Button disabled={photos.length < MIN_PORTFOLIO_PHOTOS || working} onClick={() => go('onbPackages')}>Continue to packages</Button>
        </>
      }
    >
      <H1 className="mt-5">Let your work<br />do the talking.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Your best shots. Your signature style.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {photos.map((ph, i) => (
          <div key={ph.id} className="relative">
            <button onClick={() => makeCover(ph.id)} disabled={working} aria-label={`Make photo ${i + 1} the cover`} className="block w-full">
              <Photo src={ph.src} tone={ph.tone || TONE_CYCLE[i % 4]} className="h-[150px] rounded-2xl" />
            </button>
            <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-white text-[12px] font-semibold">{i + 1}</span>
            <button onClick={() => remove(ph.id)} disabled={working} aria-label="Remove photo" className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white"><span className="-mt-0.5 text-sm leading-none">×</span></button>
            {i === 0 && <span className="absolute bottom-2 left-2 rounded-md bg-brand px-2 py-1 text-[10px] font-bold">COVER</span>}
          </div>
        ))}
      </div>
      <button
        onClick={() => fileRef.current.click()}
        disabled={photos.length >= MAX_PHOTOS || working}
        className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-dashed border-neutral-300 bg-surface p-4 text-left disabled:opacity-50"
      >
        <Icon.Plus size={22} />
        <div>
          <div className="text-[14px] font-semibold">{progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Add more photos'}</div>
          <div className="text-[11.5px] text-neutral-500">JPG or PNG · Up to 20 MB each</div>
        </div>
      </button>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => { add([...e.target.files]); e.target.value = '' }} />
      {err && <p role="alert" className="mt-2 text-[12px] text-rose-600">{err}</p>}
      <p className="mt-3 text-[11.5px] text-neutral-500">
        {photos.length} of {MAX_PHOTOS} photos · Tap a photo to make it your cover{photos.length < MIN_PORTFOLIO_PHOTOS ? ` · Add at least ${MIN_PORTFOLIO_PHOTOS}` : ''}
      </p>
    </Onb>
  )
}

/* ---------- 11. Step 3 — Packages ---------- */
export function OnbPackages() {
  const { go, set, state, auth } = useApp()
  const live = useLive()
  const [editing, setEditing] = useState(1)
  const { busy, error, run } = useAction()
  const pk = state.studioPackages
  const upd = (i, patch) => set({ studioPackages: pk.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const valid = pk.every((p) => p.price > 0 && p.photos > 0)
  const sel = `${inputCls} appearance-none`
  const next = async () => {
    if (!live) return go('payouts')
    let saved
    const ok = await run(async () => { saved = await api.savePackages(auth.photographer.id, pk) })
    if (ok) { set({ studioPackages: saved }); go('payouts') }
  }
  return (
    <Onb
      step={3}
      footer={
        <>
          <ErrorNote error={error} className="mb-2" />
          {!valid && <p className="mb-2 text-center text-[12px] text-neutral-500">Set a price for each package to continue.</p>}
          <Button disabled={!valid || busy} onClick={next}>{busy ? 'Saving…' : 'Continue to payouts'}</Button>
        </>
      }
    >
      <H1 className="mt-5">Your craft.<br />Your price.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Offer three clear ways to book you.</p>
      <div className="mt-5 space-y-3">
        {pk.map((p, i) =>
          editing === i ? (
            <div key={p.id} className="rounded-2xl border-2 border-brand bg-cream p-4">
              <div className="mb-3 flex items-center justify-between"><span className="text-[14px] font-semibold">0{i + 1} {p.name}</span><span className="text-[10px] font-bold tracking-wider text-amber-700">EDITING</span></div>
              <div className="space-y-3">
                <Field label="Price (ZAR)"><input inputMode="numeric" placeholder="e.g. R4,500" className={`${inputCls} bg-white`} value={p.price ? money(p.price) : ''} onChange={(e) => upd(i, { price: Number(e.target.value.replace(/\D/g, '').slice(0, 7)) })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Shoot duration"><select className={`${sel} bg-white`} value={p.hours} onChange={(e) => upd(i, { hours: Number(e.target.value) })}>{[1, 2, 3, 4, 6, 8, 10].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>)}</select></Field>
                  <Field label="Edited photos"><input inputMode="numeric" className={`${inputCls} bg-white`} value={p.photos || ''} onChange={(e) => upd(i, { photos: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) })} /></Field>
                </div>
                <Field label="Delivery time"><select className={`${sel} bg-white`} value={p.delivery} onChange={(e) => upd(i, { delivery: Number(e.target.value) })}>{[3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d} days after your shoot</option>)}</select></Field>
              </div>
            </div>
          ) : (
            <button key={p.id} onClick={() => setEditing(i)} className="flex w-full items-center justify-between rounded-2xl bg-surface p-4 text-left">
              <span className="text-[14px] font-semibold">0{i + 1} {p.name}</span>
              <span className={`font-display text-[17px] font-bold ${p.price ? '' : 'text-rose-600'}`}>{p.price ? money(p.price) : 'Set price'}</span>
            </button>
          ),
        )}
      </div>
      <Notice icon={<Icon.Lock size={16} />} tone="none" className="mt-4 !bg-transparent !p-0" title={<span className="font-normal text-link">All bookings are paid upfront into escrow.</span>}>
        New photographers start on Tier 1: 30% is paid within 24 hours of the shoot, and the rest after you deliver your photos.
      </Notice>
    </Onb>
  )
}

/* ---------- 12. Step 4 — NEW: Payout (bank) details ---------- */
export function Payouts() {
  const { go, set, state, auth } = useApp()
  const live = useLive()
  const saved = state.bank
  const [bank, setBank] = useState(saved?.bank || '')
  const [holder, setHolder] = useState(saved?.holder || state.studio.name)
  const [account, setAccount] = useState(saved?.account || '')
  const [type, setType] = useState(saved?.type || 'cheque')
  const [confirm, setConfirm] = useState(!!saved)
  const [touched, setTouched] = useState(false)
  const { busy, error, run } = useAction()
  const branch = BANKS.find((b) => b.name === bank)?.branch || ''
  const accOk = /^\d{7,16}$/.test(account)
  const valid = bank && holder.trim().length > 2 && accOk && confirm
  const submit = async () => {
    const details = { bank, holder: holder.trim(), account, type, branch }
    const ok = await run(async () => {
      if (live) await api.saveBank(auth.photographer.id, details)
      else await new Promise((r) => setTimeout(r, 900))
    })
    if (ok) { set({ bank: details }); go('verify') }
  }
  return (
    <Onb
      step={4}
      footer={
        <>
          <ErrorNote error={error} className="mb-2" />
          <Button disabled={!valid || busy} onClick={submit}>{busy ? 'Saving…' : 'Save & continue'}</Button>
        </>
      }
    >
      <H1 className="mt-5">Get paid,<br />safely.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Tell us where to send your earnings.</p>

      <Notice icon={<Icon.Lock size={18} />} className="mt-4" title="Your bank details. Protected.">
        Used only to pay you. Never shown on your profile or to clients.
      </Notice>

      <div className="mt-5 space-y-4">
        <Field label="Bank">
          <div className="relative">
            <select className={`${inputCls} appearance-none pr-10`} value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">Select your bank</option>
              {BANKS.map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
            <Icon.Chevron size={16} className="pointer-events-none absolute right-4 top-4 rotate-90 text-neutral-500" />
          </div>
        </Field>
        <Field label="Account holder name" hint="Must match the name on your ID.">
          <input className={inputCls} value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Account number" error={touched && account && !accOk ? 'Enter 7–16 digits, numbers only.' : ''}>
          <input
            className={inputCls}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 62012345678"
            value={account}
            onBlur={() => setTouched(true)}
            onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 16))}
          />
        </Field>
        <div>
          <span className="mb-1.5 block text-xs text-neutral-500">Account type</span>
          <Segmented value={type} onChange={setType} options={[{ value: 'cheque', label: 'Cheque / Current' }, { value: 'savings', label: 'Savings' }]} />
        </div>
        <Field label="Branch code" hint={branch ? 'Filled in automatically for your bank.' : 'Select a bank to see the branch code.'}>
          <input className={`${inputCls} text-neutral-500`} readOnly value={branch} placeholder="—" />
        </Field>
      </div>

      <div className="mt-5 rounded-2xl bg-surface p-4">
        <div className="text-[13px] font-semibold">When you’re paid</div>
        <ul className="mt-2 space-y-1.5 text-[12px] text-neutral-600">
          <li><b>Tier 1</b> · 30% within 24 hours of the shoot. <b>Tier 2</b> · 40%. <b>Tier 3</b> · 50%.</li>
          <li>The rest is paid after you upload all your edited photos and the client approves (or 48 hours pass).</li>
          <li>Our 5% fee and payment fees come off the booking total, shared across both payments.</li>
          <li>Every 5 completed bookings moves you up a tier.</li>
        </ul>
      </div>
      <div className="mt-4"><Checkbox checked={confirm} onChange={setConfirm}>I confirm this bank account is in my name, or my registered business’s name.</Checkbox></div>
    </Onb>
  )
}

/* ---------- 13. Step 5 — Verification ---------- */
function UploadRow({ icon, title, status, busy, onPick, capture, action }) {
  const ref = useRef(null)
  return (
    <button onClick={() => ref.current.click()} disabled={busy} className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left disabled:opacity-70">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white">{icon}</span>
      <div className="flex-1">
        <div className="text-[14px] font-semibold">{title}</div>
        <div className="text-[11.5px] text-neutral-500">{busy ? 'Uploading…' : status ? `${status} · Uploaded` : action}</div>
      </div>
      {status && !busy ? <Icon.Check className="text-ok" /> : <Icon.Camera size={20} />}
      <input ref={ref} type="file" accept="image/*" capture={capture} hidden onChange={(e) => { if (e.target.files[0]) onPick(e.target.files[0]); e.target.value = '' }} />
    </button>
  )
}
export function Verify() {
  const { jump, set, state, auth, refreshAccount } = useApp()
  const live = useLive()
  const docs = state.docs || {}
  const [doc, setDoc] = useState(!live || docs.sa_id_front || !docs.passport ? 'id' : 'passport')
  // Demo mode keeps the design's pre-filled example; real accounts start empty.
  const [demo, setDemo] = useState({ front: 'sa-id-front.jpg', back: 'sa-id-back.jpg', selfie: '' })
  const [uploading, setUploading] = useState('')
  const [agree, setAgree] = useState(Boolean(state.termsAccepted))
  const { busy, error, run, setError } = useAction()
  const selfieRef = useRef(null)

  const frontType = doc === 'id' ? 'sa_id_front' : 'passport'
  const has = (t) => (live ? Boolean(docs[t]) : t === 'selfie' ? Boolean(demo.selfie) : t === 'sa_id_back' ? Boolean(demo.back) : Boolean(demo.front))
  const docsOk = doc === 'id' ? has('sa_id_front') && has('sa_id_back') : has('passport')
  const selfie = has('selfie')

  const pick = async (type, file) => {
    if (!live) {
      const k = type === 'selfie' ? 'selfie' : type === 'sa_id_back' ? 'back' : 'front'
      return setDemo((d) => ({ ...d, [k]: file.name }))
    }
    setUploading(type)
    setError('')
    try {
      const path = await api.uploadDoc({ userId: auth.user.id, photographerId: auth.photographer.id, docType: type, file, previousPath: docs[type]?.path })
      set((st) => ({ docs: { ...st.docs, [type]: { path } } }))
    } catch (e) {
      setError(api.explain(e))
    } finally {
      setUploading('')
    }
  }
  const submit = async () => {
    if (!live) { set({ verification: 'pending' }); return jump('studio') }
    const ok = await run(async () => {
      await api.submitForVerification(auth.photographer.id)
      await refreshAccount(auth.user, { force: true })
    })
    if (ok) jump('studio')
  }
  const lab = (t) => (live ? (docs[t] ? 'Photo' : '') : has(t) ? (t === 'selfie' ? demo.selfie : t === 'sa_id_back' ? demo.back : demo.front) : '')

  return (
    <Onb
      step={5}
      footer={
        <>
          <ErrorNote error={error} className="mb-2" />
          <Button
            disabled={!docsOk || busy || Boolean(uploading) || (live && selfie && !agree)}
            onClick={() => (selfie ? submit() : selfieRef.current.click())}
          >
            {busy ? 'Submitting…' : selfie ? 'Submit for review' : 'Take selfie & submit'}
          </Button>
          <p className="mt-2 text-center text-[11px] text-neutral-500">Usually reviewed within 24 hours. You can go live once approved.</p>
          <input ref={selfieRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => { if (e.target.files[0]) pick('selfie', e.target.files[0]); e.target.value = '' }} />
        </>
      }
    >
      <H1 className="mt-5">Trust starts<br />with you.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Get verified. Give clients peace of mind.</p>
      <Notice icon={<Icon.Lock size={18} />} className="mt-4" title="Your identity. Protected.">Private documents, only seen by our verification team. Never shown on your profile.</Notice>
      <div className="mt-5 text-xs text-neutral-500">Document type</div>
      <div className="mt-1.5"><Segmented value={doc} onChange={setDoc} options={[{ value: 'id', label: 'SA ID card' }, { value: 'passport', label: 'Passport' }]} /></div>
      <div className="mt-4 space-y-3">
        {doc === 'id' ? (
          <>
            <UploadRow icon={<Icon.IdCard />} title="Front of ID" status={lab('sa_id_front')} busy={uploading === 'sa_id_front'} onPick={(f) => pick('sa_id_front', f)} action="Tap to upload" />
            <UploadRow icon={<Icon.IdCard />} title="Back of ID" status={lab('sa_id_back')} busy={uploading === 'sa_id_back'} onPick={(f) => pick('sa_id_back', f)} action="Tap to upload" />
          </>
        ) : (
          <UploadRow icon={<Icon.IdCard />} title="Passport photo page" status={lab('passport')} busy={uploading === 'passport'} onPick={(f) => pick('passport', f)} action="Tap to upload" />
        )}
        <UploadRow icon={<Icon.Camera />} title="Quick selfie check" status={lab('selfie')} busy={uploading === 'selfie'} onPick={(f) => pick('selfie', f)} capture="user" action="Match your face to your ID" />
      </div>
      {live && (
        <div className="mt-5">
          <Checkbox checked={agree} onChange={setAgree}>
            I agree to the photographer terms, including that I keep my original photos after delivery, because SnapshotZA deletes its copies after 15 days.
          </Checkbox>
        </div>
      )}
      <p className="mt-4 text-[12px] text-neutral-500">{selfie ? (live && !agree ? 'Tick the box above, then submit.' : 'All set — submit when you’re ready.') : 'One last step: take your selfie to submit.'}</p>
    </Onb>
  )
}
