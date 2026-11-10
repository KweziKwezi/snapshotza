import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import { supabaseConfigured } from '../lib/supabase.js'
import {
  Avatar, BottomNav, Button, Checkbox, H1, Icon, Notice, Photo, Screen, Stepper, TopBar,
} from '../ui.jsx'
import {
  CATEGORIES, DAYS_SHORT, GALLERY_RETENTION_DAYS, MONTHS, PAY_METHODS, PHOTOGRAPHERS, TIMES, isAvailable, money, packagesFor,
} from '../data.js'

/* ---------- helpers ---------- */
export function usePhotographer() {
  const { state } = useApp()
  const p = PHOTOGRAPHERS.find((x) => x.id === state.photographerId) || PHOTOGRAPHERS[0]
  const packages = packagesFor(p)
  const pkg = packages.find((x) => x.id === state.packageId) || packages[1]
  return { p, packages, pkg }
}
const shortDate = ({ m, d }) => `${d} ${MONTHS[m].slice(0, 3)}`
const endTime = (time, hours) => {
  const [h, min] = time.split(':').map(Number)
  return `${String((h + hours) % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const NAV_TARGET = { home: 'home', search: 'home', messages: 'chat', bookings: 'bookings' }
export function AppNav({ active }) {
  const { jump, auth, set } = useApp()
  const onSelect = (id) => {
    if (id !== 'profile') return jump(NAV_TARGET[id])
    // Profile tab: photographers land on their studio, signed-in users on their account, everyone else signs in.
    if (auth.status === 'in') return jump(auth.profile?.role === 'photographer' ? 'studio' : 'account')
    if (auth.status === 'out' && supabaseConfigured) return jump('auth')
    return jump('studio') // demo mode (no Supabase keys): keep the design walkthrough working
  }
  return <BottomNav active={active} onSelect={onSelect} />
}

/* ---------- 1. Splash ---------- */
export function Splash() {
  const { go, auth } = useApp()
  return (
    <Screen
      dark
      footer={
        <div>
          <button
            onClick={() => go('home')}
            className="flex h-[52px] w-full items-center justify-between rounded-2xl bg-brand px-5 text-[15px] font-semibold text-ink"
          >
            Find your photographer <Icon.Arrow />
          </button>
          {supabaseConfigured && auth.status !== 'in' && (
            <button onClick={() => go('auth')} className="mt-3 block w-full text-center text-[13px] font-semibold text-brand">Sign in or create an account</button>
          )}
          <p className="mt-3 text-center text-[11px] text-neutral-400">Made for South Africa. Built on trust.</p>
        </div>
      }
    >
      <div className="px-5 pt-2">
        <Photo src="/photos/wedding-1.jpg" tone="green" className="h-[380px] rounded-[28px]" />
        <div className="relative -mt-[50px] flex justify-center">
          <div className="flex h-[100px] w-[100px] items-center justify-center rounded-3xl bg-brand text-ink shadow-lg">
            <Icon.Bolt size={64} sw={1.6} />
          </div>
        </div>
        <h1 className="mt-6 text-center font-display text-[34px] font-extrabold tracking-tight">SnapshotZA</h1>
        <p className="mt-3 text-center text-[17px] leading-snug text-neutral-400">
          Great moments.
          <br />
          The right photographer.
        </p>
      </div>
    </Screen>
  )
}

/* ---------- 2. Home ---------- */
export function Home() {
  const { go, set, state } = useApp()
  const [cat, setCat] = useState('All')
  const [q, setQ] = useState('')
  const list = useMemo(
    () =>
      PHOTOGRAPHERS.filter(
        (p) =>
          (cat === 'All' || p.style === cat) &&
          `${p.name} ${p.city} ${p.style}`.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [cat, q],
  )
  const toggleFav = (id) =>
    set((s) => ({ favs: s.favs.includes(id) ? s.favs.filter((f) => f !== id) : [...s.favs, id] }))
  return (
    <Screen nav={<AppNav active="home" />}>
      <div className="px-5 pt-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-[11px] font-bold tracking-wider">SNAPSHOTZA</div>
            <div className="mt-1.5 flex items-center gap-1 text-[12px] text-neutral-600">
              <Icon.Pin size={14} /> Cape Town, Western Cape
            </div>
          </div>
          <button aria-label="Notifications" className="mt-1"><Icon.Bell size={22} /></button>
        </div>

        <H1 className="mt-5 text-[32px]">
          Your moment.
          <br />
          Their magic.
        </H1>

        <label className="mt-5 flex h-12 items-center gap-3 rounded-2xl bg-surface px-4">
          <Icon.Search size={18} className="text-neutral-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Photographer, location or style"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-neutral-400"
          />
        </label>

        <div className="scroll-hide -mx-5 mt-4 flex gap-2 overflow-x-auto px-5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`h-9 shrink-0 rounded-xl px-4 text-[13px] font-medium ${cat === c ? 'bg-ink text-white' : 'bg-surface text-neutral-700'}`}
            >
              {c}
            </button>
          ))}
        </div>

        <Notice icon={<Icon.Lock size={18} />} className="mt-4" title="Big memories. Zero payment worries.">
          Your money is protected until delivery.
        </Notice>

        <div className="mb-3 mt-6 flex items-center justify-between">
          <h2 className="font-display text-[18px] font-bold">Handpicked for you</h2>
          <button className="text-[13px] font-semibold text-link" onClick={() => { setCat('All'); setQ('') }}>View all</button>
        </div>

        {list.length === 0 && <p className="py-10 text-center text-sm text-neutral-500">No photographers match that yet.</p>}
        <div className="grid grid-cols-2 gap-3 pb-5">
          {list.map((p) => (
            <div key={p.id} className="relative rounded-2xl bg-white shadow-[0_1px_8px_rgba(0,0,0,0.08)]">
              <button className="block w-full text-left" onClick={() => { set({ photographerId: p.id, packageId: 'signature' }); go('profile') }}>
                <Photo src={p.cover} tone={p.tone} className="h-[150px] rounded-t-2xl" />
                <div className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-[13px] font-semibold">{p.name}</span>
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white"><Icon.Check size={10} /></span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-500">
                    {p.style} · <Icon.Star size={11} className="text-neutral-500" /> {p.rating}
                  </div>
                  <div className="mt-1.5 text-[13px] font-semibold">From {money(p.from)}</div>
                </div>
              </button>
              <button
                onClick={() => toggleFav(p.id)}
                aria-label={state.favs.includes(p.id) ? 'Remove from saved' : 'Save photographer'}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow"
              >
                <Icon.Heart size={16} filled={state.favs.includes(p.id)} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  )
}

/* ---------- 3. Photographer profile ---------- */
export function Profile() {
  const { go, back, set, state } = useApp()
  const { p, packages } = usePhotographer()
  const fav = state.favs.includes(p.id)
  return (
    <Screen
      footer={
        <>
          <div className="mb-3 flex items-center gap-2 text-[12px] text-link"><Icon.Lock size={14} /> 100% upfront. Safely held until delivery.</div>
          <Button onClick={() => go('date')}>Check availability</Button>
        </>
      }
    >
      <TopBar
        title="Photographer"
        onBack={back}
        right={
          <button
            aria-label="Save photographer"
            onClick={() => set((s) => ({ favs: s.favs.includes(p.id) ? s.favs.filter((f) => f !== p.id) : [...s.favs, p.id] }))}
          >
            <Icon.Heart filled={fav} />
          </button>
        }
      />
      <Photo src={p.cover} tone={p.tone} className="h-[200px]" />
      <div className="px-5">
        <div className="-mt-8 flex items-end justify-between">
          <div className="rounded-full border-4 border-white"><Avatar person={p} size={64} /></div>
          <span className="mb-1 flex items-center gap-1 rounded-lg bg-info px-2.5 py-1 text-[11px] font-semibold text-link">
            <Icon.Check size={12} /> ID verified
          </span>
        </div>
        <h1 className="mt-3 font-display text-[28px] font-extrabold tracking-tight">{p.name}</h1>
        <div className="text-[13px] text-neutral-500">{p.tagline}</div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-neutral-700">
          <Icon.Pin size={14} /> {p.city} · <Icon.Star size={12} /> {p.rating} ({p.reviews} reviews)
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-neutral-600">{p.bio}</p>

        <h2 className="mb-3 mt-6 font-display text-[17px] font-bold">A little of my magic</h2>
        <div className="grid grid-cols-3 gap-2">
          {['/photos/wedding-1.jpg', '/photos/wedding-2.jpg', '/photos/wedding-3.jpg'].map((s, i) => (
            <Photo key={s} src={s} tone={['green', 'dusk', 'cream'][i]} className="h-[100px] rounded-xl" />
          ))}
        </div>

        <h2 className="mt-6 font-display text-[17px] font-bold">Choose your package</h2>
        <p className="mb-3 text-[12px] text-neutral-500">All packages include a private online gallery.</p>
        <div className="space-y-3 pb-4">
          {packages.map((k) => {
            const on = state.packageId === k.id
            return (
              <button
                key={k.id}
                onClick={() => set({ packageId: k.id })}
                className={`relative block w-full rounded-2xl border p-4 text-left ${on ? 'border-brand bg-cream border-2' : 'border-line bg-white'}`}
              >
                {k.popular && (
                  <span className="absolute -top-3 right-4 flex items-center gap-1 rounded-md bg-info px-2 py-0.5 text-[10px] font-semibold text-link">
                    <Icon.Check size={10} /> Most booked
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold">{k.name}</span>
                  <span className="font-display text-[17px] font-bold">{money(k.price)}</span>
                </div>
                <div className="mt-1 text-[11.5px] text-neutral-500">
                  {k.hours} hours · {k.photos} edited photos · {k.delivery}-day delivery
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </Screen>
  )
}

/* ---------- 4. Choose date ---------- */
export function ChooseDate() {
  const { go, back, set, state } = useApp()
  const { p, pkg } = usePhotographer()
  const [view, setView] = useState({ y: state.date.y, m: state.date.m })
  const first = new Date(view.y, view.m, 1).getDay()
  const days = new Date(view.y, view.m + 1, 0).getDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const shift = (n) =>
    setView((v) => {
      const d = new Date(v.y, v.m + n, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  const selected = state.date
  const hasSel = selected && isAvailable(selected.y, selected.m, selected.d)
  const canPrev = view.y > 2026 || view.m > 10
  return (
    <Screen
      footer={
        <Button disabled={!hasSel} onClick={() => go('review')}>
          {hasSel ? `Continue · ${shortDate(selected)}, ${state.time}` : 'Pick an available date'}
        </Button>
      }
    >
      <TopBar title="Choose your date" onBack={back} />
      <Stepper steps={3} current={1} left="Book your moment" right="1 of 3" />
      <div className="px-5">
        <H1 className="mt-5">Make time for magic.</H1>
        <p className="mt-1 text-[13px] text-neutral-500">Choose an available date for your shoot.</p>

        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface p-3">
          <Avatar person={p} size={48} />
          <div>
            <div className="text-[14px] font-semibold">{p.name}</div>
            <div className="text-[12px] text-neutral-500">{pkg.name} · {pkg.hours} hours · {pkg.photos} photos</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <h2 className="font-display text-[20px] font-bold">{MONTHS[view.m]} {view.y}</h2>
          <div className="flex gap-5">
            <button aria-label="Previous month" disabled={!canPrev} onClick={() => shift(-1)} className="disabled:opacity-30"><Icon.ChevronL size={18} /></button>
            <button aria-label="Next month" onClick={() => shift(1)}><Icon.Chevron size={18} /></button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-y-1 text-center">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="pb-2 text-[11px] text-neutral-500">{d}</div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />
            const ok = isAvailable(view.y, view.m, d)
            const sel = ok && selected.y === view.y && selected.m === view.m && selected.d === d
            return (
              <button
                key={i}
                disabled={!ok}
                onClick={() => set({ date: { y: view.y, m: view.m, d } })}
                className="flex h-11 flex-col items-center justify-center"
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[14px] ${sel ? 'bg-brand font-semibold' : ok ? 'text-ink' : 'text-neutral-300'}`}>{d}</span>
                {ok && !sel && <span className="-mt-0.5 h-1 w-1 rounded-full bg-ok" />}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> Available</div>

        <h2 className="mb-3 mt-6 font-display text-[17px] font-bold">Start time</h2>
        <div className="flex gap-3 pb-4">
          {TIMES.map((t) => (
            <button
              key={t}
              onClick={() => set({ time: t })}
              className={`h-12 flex-1 rounded-2xl text-[14px] font-medium ${state.time === t ? 'bg-ink text-white' : 'bg-surface'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </Screen>
  )
}

/* ---------- 5. Review & pay ---------- */
export function Review() {
  const { go, back, state, set, auth } = useApp()
  const { p, pkg } = usePhotographer()
  const [agree, setAgree] = useState(true)
  const needsAccount = supabaseConfigured && auth.status !== 'in'
  const pay = () => {
    if (needsAccount) { set({ afterAuth: 'review' }); return go('auth') }
    go('gateway')
  }
  const total = pkg.price
  const method = PAY_METHODS.find((m) => m.id === state.payment)
  return (
    <Screen
      footer={
        <>
          <Button disabled={!agree} onClick={pay}>{needsAccount ? 'Sign in to pay' : `Pay ${money(total)} securely`}</Button>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-neutral-500"><Icon.Lock size={12} /> Encrypted & secure</div>
        </>
      }
    >
      <TopBar title="Review & pay" onBack={back} />
      <Stepper steps={3} current={2} left="Book your moment" right="2 of 3" />
      <div className="px-5">
        <H1 className="mt-5">Good moments.<br />Protected payments.</H1>

        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface p-3">
          <Avatar person={p} size={44} />
          <div>
            <div className="text-[14px] font-semibold">{p.name}</div>
            <div className="text-[12px] text-neutral-500">{pkg.name} · {pkg.hours} hours · {pkg.photos} photos</div>
          </div>
        </div>

        <div className="mt-4 border-b border-line pb-4">
          <div className="text-[14px] font-semibold">{DAYS_SHORT[new Date(state.date.y, state.date.m, state.date.d).getDay()]}, {state.date.d} {MONTHS[state.date.m].slice(0, 3)} {state.date.y} · {state.time}–{endTime(state.time, pkg.hours)}</div>
          <div className="mt-0.5 text-[12px] text-neutral-500">{p.city} · Location agreed in chat</div>
        </div>

        <div className="space-y-2.5 border-b border-line py-4 text-[14px]">
          <div className="flex justify-between"><span className="text-neutral-600">{pkg.name} package</span><span className="font-semibold">{money(pkg.price)}</span></div>
          <div className="flex justify-between"><span className="text-neutral-600">Booking protection</span><span className="font-semibold text-ok">Included</span></div>
        </div>
        <div className="flex items-center justify-between py-4">
          <span className="text-[16px] font-semibold">Total to pay</span>
          <span className="font-display text-[26px] font-extrabold">{money(total)}</span>
        </div>

        <Notice icon={<Icon.Lock size={18} />} title="Your money stays yours. Until delivery.">
          {money(total)} is held securely in escrow. {p.name.split(' ')[0]} receives the first part 24 hours after your shoot, and the rest once your photos are delivered. No extra fees for you.
          <button className="mt-1.5 block font-semibold text-link" onClick={() => go('protection')}>View payment protection</button>
        </Notice>

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-line p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface">{state.payment === 'ozow' ? <Icon.Bank size={18} /> : <Icon.Card size={18} />}</span>
            <div>
              <div className="text-[14px] font-semibold">{method.label}</div>
              <div className="text-[11.5px] text-neutral-500">via {method.provider}</div>
            </div>
          </div>
          <button onClick={() => go('payment')} className="text-[13px] font-semibold text-link">Change</button>
        </div>

        <div className="mt-4 pb-4">
          <Checkbox checked={agree} onChange={setAgree}>I agree to the shoot contract and cancellation policy.</Checkbox>
          <p className="ml-8 mt-1 text-[11.5px] text-neutral-500">Your contract is created automatically after payment.</p>
        </div>
      </div>
    </Screen>
  )
}

/* ---------- 5b. NEW — Choose payment method (hosted by gateway) ---------- */
export function PaymentMethod() {
  const { back, set, state } = useApp()
  const [sel, setSel] = useState(state.payment)
  return (
    <Screen footer={<Button onClick={() => { set({ payment: sel }); back() }}>Use {PAY_METHODS.find((m) => m.id === sel).label}</Button>}>
      <TopBar title="Payment method" onBack={back} />
      <div className="px-5">
        <H1 className="mt-3">How would you<br />like to pay?</H1>
        <p className="mt-1 text-[13px] text-neutral-500">You’ll finish on a secure page from our payment partner.</p>

        <div className="mt-5 space-y-3">
          {PAY_METHODS.map((m) => {
            const on = sel === m.id
            return (
              <button key={m.id} onClick={() => setSel(m.id)} className={`relative block w-full rounded-2xl border-2 p-4 text-left ${on ? 'border-brand bg-cream' : 'border-line bg-white'}`}>
                {m.tag && <span className="absolute -top-3 right-4 rounded-md bg-info px-2 py-0.5 text-[10px] font-semibold text-link">{m.tag}</span>}
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">{m.id === 'ozow' ? <Icon.Bank /> : <Icon.Card />}</span>
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold">{m.label} <span className="font-normal text-neutral-500">· {m.provider}</span></div>
                    <div className="text-[12px] text-neutral-500">{m.desc}</div>
                  </div>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${on ? 'border-ink bg-ink text-white' : 'border-neutral-300'}`}>{on && <Icon.Check size={11} />}</span>
                </div>
              </button>
            )
          })}
        </div>

        <Notice icon={<Icon.Shield size={18} />} className="mt-5" title="We never see your card or bank login.">
          Payment details are entered on {sel === 'ozow' ? 'Ozow’s' : 'PayFast’s'} secure page. SnapshotZA only receives a confirmation that you’ve paid.
        </Notice>
      </div>
    </Screen>
  )
}

/* ---------- 5c. Payment protection explainer ---------- */
export function Protection() {
  const { back } = useApp()
  const steps = [
    ['You pay once', 'Your full payment goes into escrow when you book.'],
    ['The shoot happens', 'Your photographer shoots. A first part is released 24 hours after, unless you report a problem.'],
    ['Photos delivered', `All your edited photos are uploaded to the app. You have 48 hours to review or approve, and ${GALLERY_RETENTION_DAYS} days to download them.`],
    ['Photographer is paid', 'The rest is released after approval, or when the review window ends.'],
  ]
  return (
    <Screen footer={<Button variant="soft" onClick={back} arrow={false}>Got it</Button>}>
      <TopBar title="Payment protection" onBack={back} />
      <div className="px-5">
        <H1 className="mt-3">Your money is safe<br />until delivery.</H1>
        <ol className="mt-6 space-y-4">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-[13px] font-bold">{i + 1}</span>
              <div><div className="text-[14px] font-semibold">{t}</div><div className="text-[12.5px] text-neutral-500">{d}</div></div>
            </li>
          ))}
        </ol>
        <Notice icon={<Icon.Shield size={18} />} className="mt-6" title="No-show? You’re refunded.">
          If your photographer doesn’t arrive, you get your payment back in full, including the booking protection fee.
        </Notice>
      </div>
    </Screen>
  )
}

/* ---------- 5d. Gateway hand-off (prototype stand-in for Ozow / PayFast) ---------- */
export function Gateway() {
  const { back, jump, set, state } = useApp()
  const method = PAY_METHODS.find((m) => m.id === state.payment)
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 1200); return () => clearTimeout(t) }, [])
  return (
    <Screen>
      <TopBar title={method.provider} onBack={back} />
      <div className="flex flex-col items-center px-8 pt-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface">
          {ready ? <Icon.Lock size={26} /> : <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-line border-t-ink" />}
        </div>
        <h1 className="mt-6 font-display text-[22px] font-extrabold">{ready ? `Ready to pay with ${method.provider}` : `Taking you to ${method.provider}…`}</h1>
        <p className="mt-2 text-[13px] text-neutral-500">
          In the live app, the real {method.provider} page opens here. This prototype lets you simulate the result.
        </p>
        <div className="mt-8 w-full space-y-3">
          <Button disabled={!ready} onClick={() => { set({ paid: true, bookingStage: 'paid' }); jump('confirmed') }}>Simulate successful payment</Button>
          <Button variant="soft" arrow={false} onClick={back}>Cancel and go back</Button>
        </div>
      </div>
    </Screen>
  )
}

/* ---------- 6. Booking confirmed ---------- */
export function Confirmed() {
  const { go, state } = useApp()
  const { p, pkg } = usePhotographer()
  return (
    <Screen
      footer={
        <div className="space-y-3">
          <Button onClick={() => go('chat')}>Message {p.name.split(' ')[0]}</Button>
          <Button variant="soft" onClick={() => go('bookings')}>View my booking</Button>
        </div>
      }
    >
      <TopBar title="Booking confirmed" onBack={() => go('home')} />
      <div className="flex flex-col items-center px-5 text-center">
        <div className="mt-2 flex h-[88px] w-[88px] items-center justify-center rounded-full bg-emerald-50 text-ok"><Icon.Check size={36} /></div>
        <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-ok">You’re all booked</div>
        <H1 className="mt-3 text-[30px]">A moment worth<br />looking forward to.</H1>
        <p className="mt-2 text-[13px] text-neutral-500">{p.name.split(' ')[0]} can’t wait to capture your story.</p>

        <div className="mt-5 w-full rounded-2xl bg-surface p-4 text-left">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">{pkg.name} session</div>
          <div className="mt-1 font-display text-[22px] font-bold">{p.name}</div>
          <div className="mt-2 flex items-center gap-2 text-[13px] text-neutral-600"><Icon.Calendar size={16} /> {state.date.d} {MONTHS[state.date.m]} {state.date.y} · {state.time}</div>
          <div className="mt-3 flex items-end justify-between text-[12px] text-neutral-500">
            <span>Booking {state.bookingRef}</span>
            <span className="text-[14px] font-semibold text-ink">{money(pkg.price)} paid</span>
          </div>
        </div>
        <div className="mt-4 flex w-full items-center gap-2 text-[13px] font-semibold text-link"><Icon.Lock size={15} /> {money(pkg.price)} protected in escrow</div>
        <p className="mt-2 w-full text-left text-[12.5px] leading-snug text-neutral-500">Contract ready. Contact details unlocked.<br />Everything you need is in your booking.</p>
      </div>
    </Screen>
  )
}

/* ---------- 6b. NEW — Bookings & escrow status ---------- */
const STAGES = [
  ['paid', 'Payment secured', 'Held in escrow'],
  ['shoot_done', 'Shoot completed', 'First part released to your photographer 24h after the shoot'],
  ['delivered', 'Photos delivered', 'You have 48 hours to review, or approve sooner'],
  ['released', 'Payment released', 'The rest is paid to your photographer'],
]
export function Bookings() {
  const { state, set, go } = useApp()
  const { p, pkg } = usePhotographer()
  const idx = STAGES.findIndex(([k]) => k === state.bookingStage)
  const [reported, setReported] = useState(false)
  return (
    <Screen nav={<AppNav active="bookings" />}>
      <div className="px-5 pt-3">
        <H1>My bookings</H1>
        <div className="mt-5 rounded-2xl bg-surface p-4">
          <div className="flex items-center gap-3">
            <Avatar person={p} size={44} />
            <div className="flex-1">
              <div className="text-[14px] font-semibold">{p.name}</div>
              <div className="text-[12px] text-neutral-500">{pkg.name} · {state.date.d} {MONTHS[state.date.m].slice(0, 3)} · {state.time}</div>
            </div>
            <span className="text-[12px] font-semibold">{money(pkg.price)}</span>
          </div>
        </div>

        <h2 className="mb-3 mt-6 font-display text-[17px] font-bold">Payment protection</h2>
        <ol className="space-y-4">
          {STAGES.map(([k, t, d], i) => {
            const done = i <= idx
            return (
              <li key={k} className="flex gap-3">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? 'bg-ok text-white' : 'bg-surface text-neutral-400'}`}>{done ? <Icon.Check size={14} /> : i + 1}</span>
                <div><div className={`text-[14px] font-semibold ${done ? '' : 'text-neutral-400'}`}>{t}</div><div className="text-[12px] text-neutral-500">{d}</div></div>
              </li>
            )
          })}
        </ol>

        <div className="mt-6 space-y-3 pb-5">
          {state.bookingStage === 'shoot_done' && (
            <Button onClick={() => set({ bookingStage: 'delivered' })}>Simulate: photographer delivers gallery</Button>
          )}
          {state.bookingStage === 'delivered' && (
            <>
              <Button onClick={() => set({ bookingStage: 'released' })}>Approve gallery & release payment</Button>
              <Button variant="soft" arrow={false} onClick={() => setReported(true)}>Report a problem</Button>
              {reported && <Notice tone="cream" title="Report received">Payment stays on hold while our team reviews your chat history and proofs.</Notice>}
            </>
          )}
          {(state.bookingStage === 'delivered' || state.bookingStage === 'released') && (
            <Notice tone="cream" icon={<Icon.Calendar size={18} />} title={`Download your photos within ${GALLERY_RETENTION_DAYS} days`}>
              After that they are deleted from SnapshotZA. Want to keep them longer? Ask {p.name.split(' ')[0]} to send you a Google Drive link in chat.
            </Notice>
          )}
          {state.bookingStage === 'released' && <Notice title="All done 🎉">Payment released to {p.name.split(' ')[0]}. Thanks for booking on SnapshotZA.</Notice>}
          <Button variant="soft" onClick={() => go('chat')}>Open chat</Button>
        </div>
      </div>
    </Screen>
  )
}

/* ---------- 7. Chat ---------- */
export function Chat() {
  const { back, go } = useApp()
  const { p } = usePhotographer()
  const [msgs, setMsgs] = useState([
    { id: 1, from: 'them', text: 'Hi Kayla! Such a beautiful celebration. Here’s a little sneak peek from your day.', time: '10:42' },
    { id: 2, from: 'proof', time: '10:42' },
    { id: 3, from: 'me', text: 'We love these! Can’t wait to see the full gallery. Thank you!', time: '10:45' },
  ])
  const [text, setText] = useState('')
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs])
  const send = () => {
    if (!text.trim()) return
    const now = new Date()
    setMsgs((m) => [...m, { id: Date.now(), from: 'me', text: text.trim(), time: now.toTimeString().slice(0, 5) }])
    setText('')
  }
  return (
    <Screen
      nav={<AppNav active="messages" />}
      footer={
        <div className="flex items-center gap-2 rounded-2xl bg-surface p-2 pl-3">
          <button aria-label="Attach"><Icon.Plus /></button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={`Message ${p.name.split(' ')[0]}...`}
            className="h-9 flex-1 bg-transparent text-[14px] outline-none placeholder:text-neutral-400"
          />
          <button onClick={send} aria-label="Send" className="flex h-10 w-10 items-center justify-center rounded-full bg-brand"><Icon.Arrow size={18} /></button>
        </div>
      }
    >
      <TopBar
        onBack={back}
        avatar={<Avatar person={p} size={40} />}
        title={<div><div className="text-[15px] font-semibold leading-tight">{p.name}</div><div className="text-[11px] font-normal text-neutral-500"><span className="text-link">ID verified</span> · Typically replies in 1h</div></div>}
      />
      <button onClick={() => go('bookings')} className="block w-full bg-info px-5 py-2.5 text-left">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-link"><Icon.Lock size={14} /> Booking paid · Contact details unlocked</div>
        <div className="ml-6 text-[11.5px] text-link">View booking & contact details</div>
      </button>
      <div className="space-y-3 px-5 py-4">
        <div className="text-center text-[10px] font-semibold uppercase tracking-wider text-neutral-400">24 November 2026</div>
        <div className="rounded-2xl bg-surface p-3.5">
          <div className="flex items-center gap-2 text-[13px] font-semibold"><span className="text-ok"><Icon.Check size={15} /></span> Shoot complete. Your memories are in the making.</div>
          <div className="ml-6 mt-1 text-[11.5px] text-neutral-500">Payment remains protected until photo delivery.</div>
        </div>
        {msgs.map((m) =>
          m.from === 'proof' ? (
            <div key={m.id} className="max-w-[88%] rounded-2xl bg-surface p-2.5">
              <Photo src="/photos/wedding-1.jpg" tone="green" className="h-[170px] rounded-xl">
                <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-md bg-black/55 px-3 py-3 text-[12px] font-semibold tracking-wide text-white">SNAPSHOTZA / PROOF</div>
              </Photo>
              <div className="mt-2 px-1 text-[12.5px]">Signature · Preview 01 of 100</div>
            </div>
          ) : (
            <div key={m.id} className={`flex ${m.from === 'me' ? 'justify-end' : ''}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-snug ${m.from === 'me' ? 'bg-[#fff3b8]' : 'bg-surface'}`}>
                {m.text}
                <div className="mt-1 text-right text-[10px] text-neutral-500">{m.time}{m.from === 'me' && ' ✓✓'}</div>
              </div>
            </div>
          ),
        )}
        <div ref={end} />
      </div>
    </Screen>
  )
}
