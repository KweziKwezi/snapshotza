// The WEBSITE version of SnapshotZA (computers, 1024px and wider). Phones keep the app version.
// Same data, same rules, same accounts: only the layout differs.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store.jsx'
import { supabaseConfigured } from '../lib/supabase.js'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { CATEGORIES, money } from '../data.js'
import { Avatar, Icon, Lightbox, NotificationBell, Photo, initials } from '../ui.jsx'
import { SearchBox, usePhotographer } from './Client.jsx'
import { Thread } from './Chat.jsx'
import { ago } from './Notifications.jsx'

export const DESKTOP_QUERY = '(min-width: 1024px)'
export function useIsDesktop() {
  const get = () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
  const [on, setOn] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const f = () => setOn(mq.matches)
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
      className={`relative h-16 px-1 text-[14.5px] font-semibold ${section === id ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full after:bg-brand' : 'text-neutral-500 hover:text-ink'}`}>
      {label}
      {id === 'messages' && state.chatUnread > 0 && <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{state.chatUnread > 9 ? '9+' : state.chatUnread}</span>}
    </button>
  )
  const me = role === 'photographer' ? 'studio' : 'account'
  const first = (auth.profile?.full_name || '').split(' ')[0]
  return (
    <header className="shrink-0 border-b border-line bg-white" data-testid="site-header">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-10 px-8">
        <Logo onClick={() => jump(signedIn ? 'home' : 'splash')} />
        <nav className="flex flex-1 items-center gap-7" aria-label="Main">
          {link('find', 'Find photographers', 'home')}
          {signedIn && link('messages', 'Messages', 'chat')}
          {signedIn && link('bookings', role === 'photographer' ? 'Bookings' : 'My bookings', 'bookings')}
        </nav>
        {signedIn ? (
          <div className="flex items-center gap-5">
            <NotificationBell count={state.unread} onClick={() => go('notifications')} />
            <button onClick={() => jump(me)} aria-current={section === 'me' ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-[14px] font-semibold ${section === 'me' ? 'border-ink' : 'border-line hover:border-neutral-400'}`}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-[12px]">{initials(auth.profile?.full_name || '?')}</span>
              {role === 'photographer' ? 'My studio' : first || 'Account'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <button onClick={() => { set({ signupRole: 'photographer', authMode: null }); go('auth') }} className="text-[14px] font-semibold text-neutral-600 hover:text-ink">For photographers</button>
            <button onClick={() => { set({ authMode: 'signin', signupRole: null }); go('auth') }} className="text-[14px] font-semibold">Sign in</button>
            <button onClick={() => { set({ authMode: null, signupRole: null }); go('auth') }} className="rounded-xl bg-ink px-4 py-2.5 text-[14px] font-semibold text-white">Create account</button>
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
      <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-8 text-[13px] text-neutral-500">
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
        <div className="mx-auto max-w-7xl px-8 py-10">
          <h1 className="font-display text-[38px] font-extrabold tracking-tight">Find your photographer</h1>
          <p className="mt-1 text-[15px] text-neutral-600">ID-verified photographers across South Africa. Your payment is held safely until your photos are delivered.</p>
          <div className="mt-6 max-w-2xl">
            <SearchBox q={q} setQ={setQ} items={items} onPlace={(label) => { setQ(label); setCat('All') }} onStyle={(c) => { setCat(c); setQ('') }} onPerson={open} />
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-7xl gap-10 px-8 py-8">
        <aside className="w-56 shrink-0" aria-label="Filters">
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-neutral-500">Style</h2>
          <ul className="mt-3 space-y-1">
            {CATEGORIES.map((c) => (
              <li key={c}>
                <button onClick={() => setCat(c)} aria-pressed={cat === c}
                  className={`w-full rounded-lg px-3 py-2 text-left text-[14px] ${cat === c ? 'bg-ink font-semibold text-white' : 'text-neutral-700 hover:bg-surface'}`}>
                  {c === 'All' ? 'All styles' : c}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-2xl bg-info p-4 text-[13px] leading-relaxed text-neutral-700">
            <div className="flex items-center gap-2 font-semibold text-link"><Icon.Lock size={15} /> Protected payments</div>
            <p className="mt-1.5">Photographers are paid in two parts: when your shoot is confirmed, and when your photos are delivered.</p>
            <button onClick={() => go('policy')} className="mt-2 font-semibold text-link">How refunds work</button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-5 flex items-center justify-between">
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
          <div className="grid grid-cols-2 gap-6 xl:grid-cols-3">
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
      <div className="mx-auto max-w-7xl px-8 py-16 text-center">
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
      <div className="mx-auto max-w-7xl px-8 pt-6">
        <button onClick={back} className="flex items-center gap-1 text-[14px] font-semibold text-neutral-600 hover:text-ink"><Icon.ChevronL size={18} /> Back to photographers</button>
      </div>
      <div className="mx-auto mt-4 grid max-w-7xl grid-cols-[minmax(0,1fr)_380px] gap-10 px-8">
        <div className="min-w-0">
          <Photo src={p.cover} tone={p.tone} label={p.cover ? undefined : initials(p.name)} className="h-[340px] rounded-3xl" />
          <div className="mt-6 flex items-start gap-5">
            <div className="-mt-14 rounded-full border-4 border-white"><Avatar person={p} size={96} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="font-display text-[34px] font-extrabold tracking-tight">{p.name}</h1>
                <span className="flex items-center gap-1 rounded-lg bg-info px-2.5 py-1 text-[12px] font-semibold text-link"><Icon.Check size={13} /> ID verified</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[14px] text-neutral-600">
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
              <div className="grid grid-cols-4 gap-3">
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
              <div className="mt-4 grid grid-cols-2 gap-4">
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
          <div className="sticky top-6 rounded-3xl border border-line p-6 shadow-[0_6px_30px_rgba(0,0,0,0.06)]" data-testid="booking-panel">
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
  const { auth, set, state } = useApp()
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
    <div className="mx-auto flex h-full max-w-7xl px-8 py-6" data-testid="web-inbox">
      <div className="flex min-h-0 w-full overflow-hidden rounded-3xl border border-line bg-white">
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-line">
          <h1 className="px-5 pb-3 pt-5 font-display text-[22px] font-bold">Messages</h1>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && <p role="alert" className="mx-5 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
            {items === null && <p className="px-5 text-[13px] text-neutral-500">Loading…</p>}
            {items?.length === 0 && !error && <p className="px-5 text-[13px] leading-relaxed text-neutral-600">Chat opens once a booking is paid. You and your {auth.profile?.role === 'photographer' ? 'client' : 'photographer'} can then agree the details here.</p>}
            {items?.map((c) => (
              <button key={c.booking_id} onClick={() => set({ chatBooking: c.booking_id })} aria-current={current === c.booking_id ? 'true' : undefined}
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
        <section className="min-w-0 flex-1">
          {current ? <Thread key={current} embedded /> : <div className="flex h-full items-center justify-center text-[14px] text-neutral-500">Choose a conversation</div>}
        </section>
      </div>
    </div>
  )
}
