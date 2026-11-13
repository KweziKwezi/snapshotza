// The WEBSITE version of SnapshotZA (computers, 1024px and wider). Phones keep the app version.
// Same data, same rules, same accounts: only the layout differs.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store.jsx'
import { supabaseConfigured } from '../lib/supabase.js'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { CATEGORIES, DAYS_SHORT, FLEX_FEE, MONTHS, money } from '../data.js'
import { Avatar, Icon, Lightbox, NotificationBell, Photo, WebContext, initials } from '../ui.jsx'
import { SearchBox, usePhotographer } from './Client.jsx'
import { Thread } from './Chat.jsx'
import { ago } from './Notifications.jsx'

// In a browser (any width) people always get the WEBSITE. The APP layout is only for the installed app
// (opened from the home screen / downloaded), or for design review with ?app in the address.
export const STANDALONE_QUERY = '(display-mode: standalone)'
export function useIsInstalledApp() {
  const get = () => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(STANDALONE_QUERY).matches || window.navigator.standalone === true || new URLSearchParams(window.location.search).has('app')
  }
  const [on, setOn] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(STANDALONE_QUERY)
    const f = () => setOn(get())
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return on
}

const Logo = ({ onClick }) => (
  <button onClick={onClick} className="flex items-center gap-2 font-display text-[19px] font-extrabold">
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand"><Icon.Bolt size={22} sw={1.8} /></span>
    SnapshotZA
  </button>
)

/* ---------- Site header ---------- */
const SECTION_OF = {
  home: 'find', profile: 'find', date: 'find', review: 'find', payment: 'find', protection: 'find', gateway: 'find', confirmed: 'find',
  chat: 'messages', thread: 'messages', bookings: 'bookings',
}
export function SiteHeader() {
  const { screen, jump, go, set, auth, state } = useApp()
  const signedIn = auth.status === 'in'
  const role = auth.profile?.role
  const section = SECTION_OF[screen] || (['account', 'studio', 'editContact', 'editProfile', 'editPortfolio', 'editBank', 'myPackages', 'availability', 'earnings'].includes(screen) ? 'me' : '')
  const link = (id, label, to) => (
    <button key={id} onClick={() => jump(to)} aria-current={section === id ? 'page' : undefined}
      className={`relative h-11 shrink-0 whitespace-nowrap px-1 text-[14.5px] font-semibold md:h-16 ${section === id ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full after:bg-brand' : 'text-neutral-500 hover:text-ink'}`}>
      {label}
      {id === 'messages' && state.chatUnread > 0 && <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{state.chatUnread > 9 ? '9+' : state.chatUnread}</span>}
    </button>
  )
  const me = role === 'photographer' ? 'studio' : 'account'
  const first = (auth.profile?.full_name || '').split(' ')[0]
  return (
    <header className="shrink-0 border-b border-line bg-white" data-testid="site-header">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 px-4 md:h-16 md:flex-nowrap md:gap-10 md:px-8">
        <div className="flex h-14 items-center md:h-auto"><Logo onClick={() => jump(signedIn ? 'home' : 'splash')} /></div>
        <nav className="order-last flex w-full items-center gap-6 overflow-x-auto md:order-none md:w-auto md:flex-1 md:gap-7" aria-label="Main">
          {link('find', 'Find photographers', 'home')}
          {signedIn && link('messages', 'Messages', 'chat')}
          {signedIn && link('bookings', role === 'photographer' ? 'Bookings' : 'My bookings', 'bookings')}
        </nav>
        {signedIn ? (
          <div className="ml-auto flex items-center gap-3 md:ml-0 md:gap-5">
            <NotificationBell count={state.unread} onClick={() => go('notifications')} />
            <button onClick={() => jump(me)} aria-current={section === 'me' ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-1 text-[14px] sm:pr-3.5 font-semibold ${section === 'me' ? 'border-ink' : 'border-line hover:border-neutral-400'}`}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-[12px]">{initials(auth.profile?.full_name || '?')}</span>
              <span className="hidden sm:inline">{role === 'photographer' ? 'My studio' : first || 'Account'}</span>
            </button>
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-3 md:ml-0 md:gap-4">
            <button onClick={() => { set({ signupRole: 'photographer', authMode: null }); go('auth') }} className="hidden text-[14px] font-semibold text-neutral-600 hover:text-ink sm:block">For photographers</button>
            <button onClick={() => { set({ authMode: 'signin', signupRole: null }); go('auth') }} className="text-[14px] font-semibold">Sign in</button>
            <button onClick={() => { set({ authMode: null, signupRole: null }); go('auth') }} className="rounded-xl bg-ink px-3 py-2 text-[13.5px] font-semibold text-white md:px-4 md:py-2.5 md:text-[14px]">Create account</button>
          </div>
        )}
      </div>
    </header>
  )
}

export function SiteFooter() {
  const { go } = useApp()
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-[13px] text-neutral-500 sm:flex-row sm:items-center sm:justify-between md:px-8">
        <span>© {new Date().getFullYear()} SnapshotZA · Made in South Africa</span>
        <button onClick={() => go('policy')} className="hover:text-ink">Cancellations & refunds</button>
      </div>
    </footer>
  )
}

/* ---------- Find photographers ---------- */
export function WebBrowse() {
  const { go, set, state, auth } = useApp()
  const live = supabaseConfigured
  const signedIn = auth.status === 'in'
  const [cat, setCat] = useState(state.homeCategory || 'All')
  useEffect(() => { if (state.homeCategory) set({ homeCategory: null }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('recommended')
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let off = false
    market.listPhotographers().then((d) => { if (!off) setItems(d) }).catch((e) => { if (!off) { setError(explain(e)); setItems([]) } })
    return () => { off = true }
  }, [])
  useEffect(() => {
    if (!live || !signedIn) return
    market.loadFavorites().then((ids) => set({ favs: ids })).catch(() => {})
  }, [live, signedIn, set])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = (items || []).filter((p) => {
      const tags = p.specialties || [p.style]
      return (cat === 'All' || tags.includes(cat)) && `${p.name} ${p.city} ${tags.join(' ')}`.toLowerCase().includes(needle)
    })
    if (sort === 'price') out.sort((a, b) => (a.from || 0) - (b.from || 0))
    if (sort === 'rating') out.sort((a, b) => (b.rating || 0) - (a.rating || 0))
    return out
  }, [items, cat, q, sort])

  const open = (p) => { set({ photographerId: p.id, packageId: null, selected: null, date: null, time: null }); go('profile') }
  const toggleFav = async (id) => {
    if (!signedIn) { set({ afterAuth: 'home' }); return go('auth') }
    const on = !state.favs.includes(id)
    set((s) => ({ favs: on ? [...s.favs, id] : s.favs.filter((f) => f !== id) }))
    try { await market.setFavorite(auth.user.id, id, on) } catch { set((s) => ({ favs: on ? s.favs.filter((f) => f !== id) : [...s.favs, id] })) }
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="web-browse">
      <section className="border-b border-line bg-surface/60">
        <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-10">
          <h1 className="font-display text-[28px] md:text-[38px] font-extrabold tracking-tight">Find your photographer</h1>
          <p className="mt-1 text-[15px] text-neutral-600">ID-verified photographers across South Africa. Your payment is held safely until your photos are delivered.</p>
          <div className="mt-6 max-w-2xl">
            <SearchBox q={q} setQ={setQ} items={items} onPlace={(label) => { setQ(label); setCat('All') }} onStyle={(c) => { setCat(c); setQ('') }} onPerson={open} />
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 md:flex-row md:gap-10 md:px-8 md:py-8">
        <aside className="shrink-0 md:w-56" aria-label="Filters">
          <h2 className="hidden text-[12px] font-bold uppercase tracking-wider text-neutral-500 md:block">Style</h2>
          <ul className="flex gap-2 overflow-x-auto pb-1 md:mt-3 md:block md:space-y-1 md:overflow-visible md:pb-0">
            {CATEGORIES.map((c) => (
              <li key={c} className="shrink-0">
                <button onClick={() => setCat(c)} aria-pressed={cat === c}
                  className={`w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-[14px] ${cat === c ? 'bg-ink font-semibold text-white' : 'text-neutral-700 hover:bg-surface'}`}>
                  {c === 'All' ? 'All styles' : c}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-8 hidden rounded-2xl bg-info p-4 text-[13px] md:block leading-relaxed text-neutral-700">
            <div className="flex items-center gap-2 font-semibold text-link"><Icon.Lock size={15} /> Protected payments</div>
            <p className="mt-1.5">Photographers are paid in two parts: when your shoot is confirmed, and when your photos are delivered.</p>
            <button onClick={() => go('policy')} className="mt-2 font-semibold text-link">How refunds work</button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] text-neutral-600">
              {items === null ? 'Finding photographers…' : `${list.length} photographer${list.length === 1 ? '' : 's'}${cat !== 'All' ? ` for ${cat}` : ''}${q ? ` matching “${q}”` : ''}`}
            </p>
            <label className="flex items-center gap-2 text-[13px] text-neutral-600">
              Sort by
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] font-semibold text-ink">
                <option value="recommended">Recommended</option>
                <option value="price">Lowest price</option>
                <option value="rating">Highest rated</option>
              </select>
            </label>
          </div>
          {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
          {items && items.length === 0 && !error && <p className="py-16 text-center text-[15px] text-neutral-500">No photographers have joined yet. Check back soon.</p>}
          {items && items.length > 0 && list.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-[15px] text-neutral-500">No photographers match that yet.</p>
              <button onClick={() => { setCat('All'); setQ('') }} className="mt-2 text-[14px] font-semibold text-link">Clear filters</button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => (
              <article key={p.id} className="group relative overflow-hidden rounded-2xl border border-line bg-white transition hover:shadow-lg" data-testid="web-card">
                <button className="block w-full text-left" onClick={() => open(p)}>
                  <Photo src={p.cover} tone={p.tone} label={p.cover ? undefined : initials(p.name)} className="aspect-[4/3] w-full" />
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-[16px] font-semibold">{p.name}</h3>
                      <span className="flex shrink-0 items-center gap-1 text-[13px]">{p.rating > 0 ? <><Icon.Star size={13} /> {Number(p.rating).toFixed(1)} <span className="text-neutral-400">({p.reviews})</span></> : <span className="text-neutral-400">New</span>}</span>
                    </div>
                    <div className="mt-0.5 text-[13px] text-neutral-500">{(p.specialties || [p.style]).join(', ')}{p.city ? ` · ${p.city.split(',')[0]}` : ''}</div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[14px]"><span className="text-neutral-500">From </span><b>{money(p.from)}</b></span>
                      <span className="flex items-center gap-1 text-[12px] font-semibold text-link"><Icon.Check size={12} /> ID verified</span>
                    </div>
                  </div>
                </button>
                <button onClick={() => toggleFav(p.id)} aria-label={state.favs.includes(p.id) ? 'Remove from saved' : 'Save photographer'}
                  className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white shadow">
                  <Icon.Heart size={17} filled={state.favs.includes(p.id)} />
                </button>
              </article>
            ))}
          </div>
        </main>
      </div>
      <SiteFooter />
    </div>
  )
}

/* ---------- Photographer page ---------- */
export function WebProfile() {
  const { go, back, set, state, auth } = useApp()
  const { p, packages } = usePhotographer()
  const [error, setError] = useState('')
  const [lb, setLb] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const loaded = state.selected?.p.id === state.photographerId

  useEffect(() => {
    if (loaded) return undefined
    let off = false
    market.loadPhotographer(state.photographerId)
      .then((sel) => { if (off) return; const pick = sel.packages.find((k) => k.popular) || sel.packages[0]; set({ selected: sel, packageId: pick ? pick.id : null }) })
      .catch((e) => { if (!off) setError(explain(e)) })
    return () => { off = true }
  }, [loaded, state.photographerId, set])

  const fav = state.favs.includes(p?.id)
  const toggleFav = async () => {
    if (auth.status !== 'in') { set({ afterAuth: 'profile' }); return go('auth') }
    const on = !fav
    set((s) => ({ favs: on ? [...s.favs, p.id] : s.favs.filter((f) => f !== p.id) }))
    try { await market.setFavorite(auth.user.id, p.id, on) } catch { set((s) => ({ favs: on ? s.favs.filter((f) => f !== p.id) : [...s.favs, p.id] })) }
  }

  if (!loaded) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center md:px-8">
        {error ? <p role="alert" className="inline-block rounded-xl bg-rose-50 p-3 text-[14px] text-rose-700">{error}</p> : <p className="text-[15px] text-neutral-500">Loading…</p>}
      </div>
    )
  }
  const all = state.selected.portfolio
  const visible = showAll ? all : all.slice(0, 8)
  const reviews = state.selected.reviews
  const pkg = packages.find((k) => k.id === state.packageId)

  return (
    <div className="h-full overflow-y-auto" data-testid="web-profile">
      <div className="mx-auto max-w-7xl px-4 pt-4 md:px-8 md:pt-6">
        <button onClick={back} className="flex items-center gap-1 text-[14px] font-semibold text-neutral-600 hover:text-ink"><Icon.ChevronL size={18} /> Back to photographers</button>
      </div>
      <div className="mx-auto mt-4 grid max-w-7xl grid-cols-1 gap-8 px-4 md:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
        <div className="min-w-0">
          <Photo src={p.cover} tone={p.tone} label={p.cover ? undefined : initials(p.name)} className="h-[220px] rounded-3xl md:h-[340px]" />
          <div className="mt-6 flex flex-col items-start gap-3 md:flex-row md:gap-5">
            <div className="-mt-14 rounded-full border-4 border-white"><Avatar person={p} size={96} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-[26px] font-extrabold tracking-tight md:text-[34px]">{p.name}</h1>
                <span className="flex items-center gap-1 rounded-lg bg-info px-2.5 py-1 text-[12px] font-semibold text-link"><Icon.Check size={13} /> ID verified</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-neutral-600">
                {p.city && <><Icon.Pin size={15} /> {p.city} · </>}
                {p.rating > 0 ? <><Icon.Star size={14} /> {Number(p.rating).toFixed(1)} ({p.reviews} reviews)</> : 'New on SnapshotZA'}
                {p.specialties?.length > 0 && <> · {p.specialties.join(', ')}</>}
              </div>
            </div>
            <button onClick={toggleFav} className="flex items-center gap-2 rounded-xl border border-line px-4 py-2 text-[14px] font-semibold hover:border-neutral-400">
              <Icon.Heart size={17} filled={fav} /> {fav ? 'Saved' : 'Save'}
            </button>
          </div>
          {p.bio && <p className="mt-5 max-w-3xl text-[15.5px] leading-relaxed text-neutral-700">{p.bio}</p>}

          {all.length > 0 && (
            <section className="mt-10">
              <div className="mb-4 flex items-end justify-between">
                <h2 className="font-display text-[22px] font-bold">Portfolio</h2>
                <span className="text-[13px] text-neutral-500">{all.length} photo{all.length === 1 ? '' : 's'}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {visible.map((ph, i) => (
                  <button key={ph.id} onClick={() => setLb(i)} aria-label={`Open photo ${i + 1} of ${all.length}`} className="block overflow-hidden rounded-xl">
                    <Photo src={ph.src} tone={['green', 'dusk', 'cream', 'warm'][i % 4]} className="aspect-square w-full transition hover:scale-[1.03]" />
                  </button>
                ))}
              </div>
              {all.length > 8 && <button onClick={() => setShowAll((v) => !v)} className="mt-4 text-[14px] font-semibold text-link">{showAll ? 'Show fewer' : `Show all ${all.length} photos`}</button>}
            </section>
          )}
          {lb !== null && <Lightbox photos={all} index={lb} onIndex={setLb} onClose={() => setLb(null)} />}

          <section className="mt-10">
            <h2 className="font-display text-[22px] font-bold">Reviews</h2>
            {reviews.length === 0 ? <p className="mt-2 text-[14px] text-neutral-500">No reviews yet. Be the first to book and share your experience.</p> : (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {reviews.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-line p-4">
                    <div className="flex items-center gap-1 text-[13px] font-semibold"><Icon.Star size={13} /> {r.rating}.0 <span className="font-normal text-neutral-400">· Verified client · {new Date(r.created_at).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })}</span></div>
                    {r.comment && <p className="mt-1.5 text-[14px] leading-relaxed text-neutral-700">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside>
          <div className="rounded-3xl border border-line p-5 shadow-[0_6px_30px_rgba(0,0,0,0.06)] md:p-6 lg:sticky lg:top-6" data-testid="booking-panel">
            <h2 className="font-display text-[20px] font-bold">Book {p.name.split(' ')[0]}</h2>
            <p className="mt-0.5 text-[13px] text-neutral-500">Choose a package. All include a private online gallery.</p>
            {packages.length === 0 && <p className="mt-4 rounded-xl bg-surface p-3 text-[13px] text-neutral-600">This photographer has not set up packages yet.</p>}
            <div className="mt-4 space-y-2.5" role="radiogroup" aria-label="Package">
              {packages.map((k) => {
                const on = state.packageId === k.id
                return (
                  <button key={k.id} role="radio" aria-checked={on} onClick={() => set({ packageId: k.id })}
                    className={`block w-full rounded-2xl border p-3.5 text-left ${on ? 'border-2 border-brand bg-cream' : 'border-line hover:border-neutral-400'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[14.5px] font-semibold">{k.name}{k.popular && <span className="ml-2 rounded bg-info px-1.5 py-0.5 text-[10px] font-semibold text-link">Most booked</span>}</span>
                      <span className="font-display text-[17px] font-bold">{money(k.price)}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">{k.hours} hours · {k.photos} edited photos · {k.delivery}-day delivery</div>
                  </button>
                )
              })}
            </div>
            <button disabled={!pkg} onClick={() => go('date')} className="mt-5 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-semibold text-ink disabled:opacity-45">
              Check availability <Icon.Arrow size={18} />
            </button>
            <ul className="mt-4 space-y-2 text-[12.5px] text-neutral-600">
              <li className="flex gap-2"><Icon.Lock size={14} className="mt-0.5 shrink-0 text-link" /> Paid upfront, held safely until delivery</li>
              <li className="flex gap-2"><Icon.Shield size={14} className="mt-0.5 shrink-0 text-link" /> 100% back if the photographer does not show up</li>
              <li className="flex gap-2"><Icon.Calendar size={14} className="mt-0.5 shrink-0 text-link" /> Flexible rate: cancel or move your date</li>
            </ul>
          </div>
        </aside>
      </div>
      <SiteFooter />
    </div>
  )
}

/* ---------- Messages: two-pane inbox ---------- */
export function WebInbox() {
  const { auth, set, state, screen } = useApp()
  const [showThread, setShowThread] = useState(screen === 'thread')   // phones: list first, then the chat
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setItems(await market.listConversations()); setError('') } catch (e) { setError(explain(e)); setItems((v) => v || []) }
  }, [])
  useEffect(() => {
    if (auth.status !== 'in') return undefined
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [auth.status, load])
  const current = state.chatBooking
  useEffect(() => { if (!current && items?.length) set({ chatBooking: items[0].booking_id }) }, [current, items, set])

  return (
    <div className="mx-auto flex h-full max-w-7xl px-0 py-0 md:px-8 md:py-6" data-testid="web-inbox">
      <div className="flex min-h-0 w-full overflow-hidden bg-white md:rounded-3xl md:border md:border-line">
        <aside className={`${showThread ? 'hidden' : 'flex'} w-full shrink-0 flex-col border-r border-line md:flex md:w-[340px]`}>
          <h1 className="px-5 pb-3 pt-5 font-display text-[22px] font-bold">Messages</h1>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && <p role="alert" className="mx-5 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
            {items === null && <p className="px-5 text-[13px] text-neutral-500">Loading…</p>}
            {items?.length === 0 && !error && <p className="px-5 text-[13px] leading-relaxed text-neutral-600">Chat opens once a booking is paid. You and your {auth.profile?.role === 'photographer' ? 'client' : 'photographer'} can then agree the details here.</p>}
            {items?.map((c) => (
              <button key={c.booking_id} onClick={() => { set({ chatBooking: c.booking_id }); setShowThread(true) }} aria-current={current === c.booking_id ? 'true' : undefined}
                className={`flex w-full items-center gap-3 px-5 py-3.5 text-left ${current === c.booking_id ? 'bg-cream' : 'hover:bg-surface'}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface text-[12px] font-semibold">
                  {c.other_photo ? <img src={c.other_photo} alt="" className="h-full w-full object-cover" /> : initials(c.other_name || '?')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-[14px] ${c.unread > 0 ? 'font-bold' : 'font-semibold'}`}>{c.other_name || 'Chat'}</span>
                    <span className="shrink-0 text-[11px] text-neutral-400">{ago(c.last_at)}</span>
                  </span>
                  <span className="block truncate text-[12px] text-neutral-500">{c.booking_ref}{c.status === 'cancelled' ? ' · cancelled' : ''}</span>
                  <span className={`block truncate text-[12.5px] ${c.unread > 0 ? 'font-semibold text-ink' : 'text-neutral-600'}`}>{c.last_message ? `${c.last_from_me ? 'You: ' : ''}${c.last_message}` : 'Say hello'}</span>
                </span>
                {c.unread > 0 && <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">{c.unread}</span>}
              </button>
            ))}
          </div>
        </aside>
        <section className={`${showThread ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col md:flex`}>
          <button onClick={() => setShowThread(false)} className="flex items-center gap-1 border-b border-line px-4 py-2.5 text-[14px] font-semibold md:hidden"><Icon.ChevronL size={18} /> All messages</button>
          {current ? <Thread key={current} embedded /> : <div className="flex h-full items-center justify-center text-[14px] text-neutral-500">Choose a conversation</div>}
        </section>
      </div>
    </div>
  )
}

/* =====================================================================================================================
   Website layouts for every other screen. The screens themselves are shared with the app (same logic, same rules);
   inside these layouts they render as web pages (see WebContext in ui.jsx).
   ===================================================================================================================== */

const Scroll = ({ children, testid }) => <div className="h-full overflow-y-auto" data-testid={testid}>{children}</div>
const AsWeb = ({ children }) => <WebContext.Provider value>{children}</WebContext.Provider>

/* ---------- Account / studio / admin: dashboard with a side menu ---------- */
const MENUS = {
  client: [
    ['Your account', [['account', 'Overview', Icon.User], ['bookings', 'My bookings', Icon.Calendar], ['chat', 'Messages', Icon.Message], ['notifications', 'Notifications', Icon.Bell]]],
    ['Settings', [['editContact', 'Contact details', Icon.IdCard]]],
  ],
  photographer: [
    ['Studio', [['studio', 'Dashboard', Icon.Home], ['bookings', 'Bookings', Icon.Calendar], ['earnings', 'Earnings', Icon.Bank], ['chat', 'Messages', Icon.Message], ['notifications', 'Notifications', Icon.Bell]]],
    ['Your profile', [['editProfile', 'Profile & photo', Icon.User], ['editPortfolio', 'Portfolio', Icon.Camera], ['myPackages', 'Packages', Icon.Card], ['availability', 'Hours & days', Icon.Calendar]]],
    ['Settings', [['editBank', 'Bank details', Icon.Bank], ['editContact', 'Contact details', Icon.IdCard]]],
  ],
  admin: [
    ['Admin', [['account', 'Overview', Icon.Shield], ['adminList', 'Photographer reviews', Icon.Eye], ['adminReports', 'Problem reports', Icon.Message], ['adminPayouts', 'Payouts to send', Icon.Bank], ['adminRefunds', 'Refunds to send', Icon.Card], ['adminBanks', 'Bank checks', Icon.Check]]],
    ['You', [['notifications', 'Notifications', Icon.Bell], ['editContact', 'Contact details', Icon.IdCard]]],
  ],
}
const MENU_ALIAS = { adminReview: 'adminList', adminReport: 'adminReports' }

export function WebDashboard({ Current, screen }) {
  const { auth, jump, signOut, state } = useApp()
  const role = auth.profile?.role === 'admin' ? 'admin' : auth.profile?.role === 'photographer' ? 'photographer' : 'client'
  const active = MENU_ALIAS[screen] || screen
  const studioNotReady = role === 'photographer' && auth.photographer && auth.photographer.verification_status !== 'approved'
  return (
    <Scroll testid="web-dashboard">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-10 md:px-8 md:py-8">
        <aside className="shrink-0 md:w-60" aria-label="Account menu">
          <div className="md:sticky md:top-8">
            <div className="mb-6 hidden items-center gap-3 md:flex">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-[13px] font-semibold">{initials(auth.profile?.full_name || '?')}</span>
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-semibold">{auth.profile?.full_name || 'Your account'}</div>
                <div className="text-[12px] capitalize text-neutral-500">{role}</div>
              </div>
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:block md:overflow-visible md:px-0 md:pb-0">
            {MENUS[role].map(([group, items]) => (
              <nav key={group} className="flex shrink-0 gap-2 md:mb-6 md:block" aria-label={group}>
                <div className="mb-1.5 hidden px-3 text-[11px] font-bold uppercase tracking-wider text-neutral-400 md:block">{group}</div>
                {items.map(([to, label, I]) => {
                  const disabled = studioNotReady && !['studio', 'notifications', 'editContact', 'chat'].includes(to)
                  const badge = to === 'chat' ? state.chatUnread : to === 'notifications' ? state.unread : 0
                  return (
                    <button key={to} disabled={disabled} onClick={() => jump(to)} aria-current={active === to ? 'page' : undefined}
                      className={`flex shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-left text-[14px] disabled:opacity-40 md:w-full md:py-2.5 ${active === to ? 'bg-ink font-semibold text-white' : 'text-neutral-700 hover:bg-surface'}`}>
                      <I size={18} /> <span className="flex-1">{label}</span>
                      {badge > 0 && <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{badge > 9 ? '9+' : badge}</span>}
                    </button>
                  )
                })}
              </nav>
            ))}
            <button onClick={signOut} className="shrink-0 whitespace-nowrap px-3 text-[13.5px] font-semibold text-neutral-500 hover:text-ink">Sign out</button>
            </div>
          </div>
        </aside>
        <main className="min-w-0 max-w-4xl flex-1">
          <AsWeb><Current /></AsWeb>
        </main>
      </div>
    </Scroll>
  )
}

/* ---------- Booking steps: checkout with a summary on the side ---------- */
const FLOW_STEPS = [['date', 'Date & time'], ['review', 'Rate & details'], ['gateway', 'Payment'], ['confirmed', 'Confirmed']]
const FLOW_STEP_OF = { date: 0, review: 1, payment: 1, protection: 1, gateway: 2, confirmed: 3 }

function BookingSummary() {
  const { state } = useApp()
  const { p, pkg } = usePhotographer()
  const b = state.reservation
  const d = state.date
  const when = d ? `${DAYS_SHORT[new Date(d.y, d.m, d.d).getDay()]} ${d.d} ${MONTHS[d.m].slice(0, 3)} ${d.y}${state.time ? ` · ${state.time}` : ''}` : 'Choose a date'
  const rate = b?.rate_type || state.rate
  const price = b ? Number(b.package_price ?? b.total_amount) : pkg.price
  const total = b ? Number(b.total_amount) : pkg.price + (rate === 'flexible' ? FLEX_FEE : 0)
  return (
    <div className="rounded-3xl border border-line p-5 shadow-[0_6px_30px_rgba(0,0,0,0.06)] md:p-6 lg:sticky lg:top-8" data-testid="booking-summary">
      <h2 className="font-display text-[18px] font-bold">Your booking</h2>
      {p?.name && (
        <div className="mt-4 flex items-center gap-3">
          <Avatar person={p} size={48} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{p.name}</div>
            <div className="text-[12.5px] text-neutral-500">{p.city?.split(',')[0]}</div>
          </div>
        </div>
      )}
      <dl className="mt-5 space-y-3 border-t border-line pt-4 text-[14px]">
        <div className="flex justify-between gap-4"><dt className="text-neutral-500">Package</dt><dd className="text-right font-semibold">{pkg.name || '—'}{pkg.hours ? <span className="block text-[12px] font-normal text-neutral-500">{pkg.hours} hours · {pkg.photos} photos</span> : null}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-neutral-500">When</dt><dd className="text-right font-semibold">{when}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-neutral-500">Rate</dt><dd className="text-right font-semibold">{rate ? (rate === 'flexible' ? 'Flexible' : 'Saver') : 'Choose at the next step'}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-neutral-500">Package price</dt><dd className="font-semibold">{money(price)}</dd></div>
        {rate === 'flexible' && <div className="flex justify-between gap-4"><dt className="text-neutral-500">Flexible rate</dt><dd className="font-semibold">{money(FLEX_FEE)}</dd></div>}
      </dl>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <span className="text-[15px] font-semibold">Total</span>
        <span className="font-display text-[24px] font-extrabold">{money(total)}</span>
      </div>
      <p className="mt-4 flex gap-2 text-[12.5px] text-neutral-600"><Icon.Lock size={14} className="mt-0.5 shrink-0 text-link" /> Held safely: the photographer is paid when your shoot is confirmed and your photos are delivered.</p>
    </div>
  )
}

export function WebFlow({ Current, screen }) {
  const step = FLOW_STEP_OF[screen] ?? 0
  return (
    <Scroll testid="web-flow">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <ol className="mb-6 flex items-center gap-3 md:mb-8" aria-label="Booking steps">
          {FLOW_STEPS.map(([id, label], i) => (
            <li key={id} className="flex items-center gap-3" aria-current={i === step ? 'step' : undefined}>
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${i < step ? 'bg-ink text-white' : i === step ? 'bg-brand text-ink' : 'bg-surface text-neutral-400'}`}>{i < step ? <Icon.Check size={13} /> : i + 1}</span>
              <span className={`text-[14px] font-semibold ${i === step ? 'text-ink' : 'hidden text-neutral-400 sm:inline'}`}>{label}</span>
              {i < FLOW_STEPS.length - 1 && <span className="hidden h-px w-10 bg-line sm:block" />}
            </li>
          ))}
        </ol>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">
          <div className="min-w-0"><AsWeb><Current /></AsWeb></div>
          <aside><BookingSummary /></aside>
        </div>
      </div>
      <SiteFooter />
    </Scroll>
  )
}

/* ---------- Sign in / create account: split page ---------- */
export function WebAuth({ Current }) {
  const { state, jump, auth } = useApp()
  const photographer = state.signupRole === 'photographer'
  const points = photographer
    ? ['No monthly fees: 7% plus the payment fee, only when you are booked', 'Clients pay upfront, so no chasing deposits', 'Up to 50% of your earnings released when the shoot is confirmed']
    : ['ID-verified photographers across South Africa', 'Your payment is held until your photos are delivered', '100% back if your photographer does not show up']
  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-2" data-testid="web-auth">
      <section className="hidden flex-col justify-between bg-ink p-10 text-white md:flex lg:p-14">
        <div>
          <div className="mb-14 text-white [&_span]:text-ink"><Logo onClick={() => jump(auth.status === 'in' ? 'home' : 'splash')} /></div>
          <p className="text-[13px] font-bold uppercase tracking-wider text-brand">{photographer ? 'For photographers' : 'SnapshotZA'}</p>
          <h1 className="mt-4 max-w-md font-display text-[44px] font-extrabold leading-[1.05] tracking-tight">{photographer ? 'Get booked. Get paid. Safely.' : 'Great moments. The right photographer.'}</h1>
          <ul className="mt-10 space-y-4 text-[15.5px] text-neutral-300">
            {points.map((t) => <li key={t} className="flex gap-3"><Icon.Check size={18} className="mt-0.5 shrink-0 text-brand" /> {t}</li>)}
          </ul>
        </div>
        <p className="text-[13px] text-neutral-500">Made for South Africa. Built on trust.</p>
      </section>
      <section className="h-full overflow-y-auto">
        <div className="mx-auto max-w-md px-5 py-6 md:px-6 md:py-14"><div className="mb-4 md:hidden"><Logo onClick={() => jump(auth.status === 'in' ? 'home' : 'splash')} /></div><AsWeb><Current /></AsWeb></div>
      </section>
    </div>
  )
}

/* ---------- Photographer onboarding: steps on the side ---------- */
const ONB = [['onbProfile', 'Profile', 'Your name, photo and style'], ['onbPortfolio', 'Portfolio', 'At least 5 of your best photos'], ['onbPackages', 'Packages', 'Three ways to book you'], ['payouts', 'Payouts', 'Where we send your money'], ['verify', 'Verification', 'Your ID, checked by our team']]
export function WebOnboarding({ Current, screen }) {
  const { jump } = useApp()
  const step = Math.max(0, ONB.findIndex(([id]) => id === screen))
  return (
    <Scroll testid="web-onboarding">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row md:gap-12 md:px-8 md:py-10">
        <aside className="shrink-0 md:w-72">
          <div className="md:sticky md:top-10">
            <p className="text-[12px] font-bold uppercase tracking-wider text-neutral-400">Create your studio</p>
            <ol className="mt-3 flex gap-1 overflow-x-auto md:mt-5 md:block md:space-y-1 md:overflow-visible" aria-label="Setup steps">
              {ONB.map(([id, label, hint], i) => (
                <li key={id} aria-current={i === step ? 'step' : undefined} className={`flex shrink-0 gap-3 rounded-2xl p-2 md:p-3 ${i === step ? 'bg-cream' : ''}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${i < step ? 'bg-ink text-white' : i === step ? 'bg-brand' : 'bg-surface text-neutral-400'}`}>{i < step ? <Icon.Check size={14} /> : i + 1}</span>
                  <span>
                    <span className={`block text-[14.5px] font-semibold ${i > step ? 'text-neutral-400' : ''}`}>{label}</span>
                    <span className="hidden text-[12.5px] text-neutral-500 md:block">{hint}</span>
                  </span>
                </li>
              ))}
            </ol>
            <button onClick={() => jump('studio')} className="mt-6 px-3 text-[13.5px] font-semibold text-neutral-500 hover:text-ink">Save & exit</button>
          </div>
        </aside>
        <main className="min-w-0 max-w-2xl flex-1"><AsWeb><Current /></AsWeb></main>
      </div>
    </Scroll>
  )
}

/* ---------- Plain document pages (policy) and anything else ---------- */
export function WebDoc({ Current }) {
  return (
    <Scroll testid="web-doc">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10"><AsWeb><Current /></AsWeb></div>
      <SiteFooter />
    </Scroll>
  )
}
