import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import * as market from '../lib/market.js'
import { FLEX_FEE, FREE_CANCEL_HOURS, GALLERY_RETENTION_DAYS, REFUND_DAYS, SPECIALTIES, money } from '../data.js'
import { Icon, Photo } from '../ui.jsx'

const TONES = ['green', 'dusk', 'warm', 'cool', 'sand', 'rust']

const STEPS = [
  [Icon.Search, 'Find your photographer', 'Browse ID-verified photographers near you, see their real work and clear package prices.'],
  [Icon.Lock, 'Book and pay safely', 'Pick a date and time. Your payment is held securely, not handed straight to the photographer.'],
  [Icon.Camera, 'Have your shoot', 'Agree the details in chat. After the shoot you confirm it happened, which releases the first part of the payment.'],
  [Icon.Check, 'Get your photos', `Your edited photos are delivered in the app. Approve them, then download them within ${GALLERY_RETENTION_DAYS} days.`],
]

const FAQ_CLIENT = [
  ['When does the photographer get paid?', 'Part of the payment is released once you confirm the shoot happened (or 24 hours after the photographer marks it complete). The rest is released once you approve your photos, or 48 hours after they are delivered.'],
  ['What if my photographer does not show up?', `You get 100% of what you paid back within ${REFUND_DAYS} days, including the flexible-rate fee. The photographer gets a strike.`],
  ['Can I cancel or change my date?', `With the Flexible rate (${money(FLEX_FEE)} more) you can cancel up to ${FREE_CANCEL_HOURS} hours before the shoot for a refund of the package price, or change your date once if your photographer agrees. The Saver rate is our lowest price, with no refunds or date changes.`],
  ['What if I am not happy with my photos?', 'Report a problem in the app before you approve them. Our team looks at the booking and decides within 5 working days.'],
  ['How long can I download my photos?', `For ${GALLERY_RETENTION_DAYS} days after they are approved. After that they are deleted, so save them (Google Drive works well for long-term copies).`],
]
const FAQ_PHOTOGRAPHER = [
  ['What does it cost?', 'Nothing to join and no monthly fees. We take 7% of the package price, plus the payment processing fee (2.9% + R1). Clients pay the price on your package, nothing extra.'],
  ['When do I get paid?', 'Your first payment (30% of your earnings, rising to 40% and 50% as you complete bookings) is released when the shoot is confirmed. The rest follows once the client approves your photos, or 48 hours after delivery.'],
  ['What if a client cancels?', `On the Saver rate, or within ${FREE_CANCEL_HOURS} hours of the shoot, you keep your full earnings. Clients who pay for the Flexible rate can cancel earlier for a refund, which frees the date for another booking.`],
  ['How do I get approved?', 'Create your studio: profile, at least 5 portfolio photos, your packages and bank details, plus your ID. We check every photographer before they can take bookings.'],
]

function Faq({ items }) {
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-white">
      {items.map(([q, a]) => (
        <details key={q} className="group p-4 open:bg-surface/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold">
            {q}
            <Icon.Chevron size={18} className="shrink-0 transition group-open:rotate-90" />
          </summary>
          <p className="mt-2 text-[14px] leading-relaxed text-neutral-600">{a}</p>
        </details>
      ))}
    </div>
  )
}

export function Landing() {
  const { go, set } = useApp()
  const [people, setPeople] = useState(null)
  const scroller = useRef(null)
  useEffect(() => {
    let off = false
    market.listPhotographers().then((l) => { if (!off) setPeople(l.slice(0, 8)) }).catch(() => { if (!off) setPeople([]) })
    return () => { off = true }
  }, [])
  const to = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const findPhotographer = (style) => { if (style) set({ homeCategory: style }); go('home') }
  const joinAsPhotographer = () => { set({ signupRole: 'photographer' }); go('auth') }
  const signIn = () => { set({ signupRole: null, authMode: 'signin' }); go('auth') }
  const covers = (people || []).filter((p) => p.cover).slice(0, 3)

  return (
    <div ref={scroller} className="scroll-hide h-full overflow-y-auto bg-white" data-testid="landing">
      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <div className="flex items-center gap-2 font-display text-[18px] font-extrabold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand"><Icon.Bolt size={20} sw={1.8} /></span>
            SnapshotZA
          </div>
          <nav className="hidden flex-1 items-center gap-6 text-[14px] font-medium text-neutral-600 md:flex" aria-label="Page sections">
            <button onClick={() => to('how')}>How it works</button>
            <button onClick={() => to('protection')}>Payment protection</button>
            <button onClick={() => to('photographers')}>For photographers</button>
            <button onClick={() => to('faq')}>FAQ</button>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <button onClick={signIn} className="text-[14px] font-semibold">Sign in</button>
            <button onClick={() => findPhotographer()} className="hidden rounded-xl bg-ink px-4 py-2.5 text-[14px] font-semibold text-white sm:block">Find a photographer</button>
          </div>
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 md:grid-cols-2 md:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold text-brand">
              <Icon.Shield size={14} /> Made for South Africa
            </p>
            <h1 className="mt-5 font-display text-[40px] font-extrabold leading-[1.05] tracking-tight md:text-[56px]">
              Great moments.<br />The right photographer.
            </h1>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-neutral-300 md:text-[18px]">
              Book a verified photographer for your wedding, matric dance, family shoot or event. Your payment is held safely until your photos are delivered.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button onClick={() => findPhotographer()} className="flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-brand px-6 text-[15px] font-semibold text-ink">
                Find a photographer <Icon.Arrow size={18} />
              </button>
              <button onClick={joinAsPhotographer} className="flex h-[52px] items-center justify-center rounded-2xl border border-white/25 px-6 text-[15px] font-semibold">
                I'm a photographer
              </button>
            </div>
            <ul className="mt-8 grid gap-2 text-[13px] text-neutral-300 sm:grid-cols-3">
              <li className="flex items-center gap-2"><Icon.Check size={15} className="text-brand" /> ID-verified photographers</li>
              <li className="flex items-center gap-2"><Icon.Check size={15} className="text-brand" /> Payment held until delivery</li>
              <li className="flex items-center gap-2"><Icon.Check size={15} className="text-brand" /> No hidden fees</li>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Photo key={i} src={covers[i]?.cover || null} tone={TONES[i]} className={`rounded-3xl ${i === 0 ? 'row-span-2 h-[320px] md:h-[420px]' : 'h-[154px] md:h-[204px]'}`} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- styles ---------- */}
      <section className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-5 py-5">
          <span className="mr-2 text-[13px] font-semibold text-neutral-500">Popular:</span>
          {SPECIALTIES.slice(0, 8).map((s) => (
            <button key={s} onClick={() => findPhotographer(s)} className="rounded-full bg-surface px-4 py-2 text-[13px] font-medium hover:bg-line">{s}</button>
          ))}
        </div>
      </section>

      {/* ---------- featured photographers ---------- */}
      {people && people.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-[28px] font-extrabold tracking-tight md:text-[34px]">Photographers on SnapshotZA</h2>
            <button onClick={() => findPhotographer()} className="shrink-0 text-[14px] font-semibold text-link">See all</button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {people.slice(0, 4).map((p, i) => (
              <button key={p.id} onClick={() => { set({ photographerId: p.id, selected: null }); go('profile') }} className="text-left" data-testid="featured">
                <Photo src={p.cover} tone={TONES[i % TONES.length]} className="h-[180px] rounded-2xl md:h-[220px]" />
                <div className="mt-2 text-[15px] font-semibold">{p.name}</div>
                <div className="text-[12.5px] text-neutral-500">{p.style}{p.city ? ` · ${p.city.split(',')[0]}` : ''}</div>
                {p.from > 0 && <div className="mt-0.5 text-[13px] font-semibold">From {money(p.from)}</div>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- how it works ---------- */}
      <section id="how" className="bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="font-display text-[28px] font-extrabold tracking-tight md:text-[34px]">How it works</h2>
          <p className="mt-2 max-w-xl text-[15px] text-neutral-600">From finding your photographer to downloading your photos, everything happens in one place.</p>
          <ol className="mt-8 grid gap-4 md:grid-cols-4">
            {STEPS.map(([I, title, text], i) => (
              <li key={title} className="rounded-2xl bg-white p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand"><I size={20} /></span>
                  <span className="text-[12px] font-bold text-neutral-400">STEP {i + 1}</span>
                </div>
                <h3 className="mt-4 text-[16px] font-semibold">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-neutral-600">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- protection + rates ---------- */}
      <section id="protection" className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="font-display text-[28px] font-extrabold tracking-tight md:text-[34px]">Your money stays protected</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">
              You pay upfront, but the photographer is paid in two parts: when the shoot is confirmed, and when your photos are delivered and approved.
            </p>
            <ul className="mt-6 space-y-4 text-[14.5px]">
              <li className="flex gap-3"><Icon.Shield size={20} className="mt-0.5 shrink-0 text-link" /><span><b>Photographer no-show?</b> You get 100% back within {REFUND_DAYS} days.</span></li>
              <li className="flex gap-3"><Icon.Message size={20} className="mt-0.5 shrink-0 text-link" /><span><b>A problem with the photos?</b> Report it in the app. A real person decides within 5 working days and tells you why.</span></li>
              <li className="flex gap-3"><Icon.Lock size={20} className="mt-0.5 shrink-0 text-link" /><span><b>Private by default.</b> Your phone number is only shared once a booking is paid.</span></li>
            </ul>
          </div>
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-neutral-500">Choose your rate when you book</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border-2 border-line p-5">
                <div className="text-[17px] font-semibold">Saver</div>
                <div className="text-[13px] text-neutral-500">The package price</div>
                <ul className="mt-4 space-y-2 text-[13.5px] text-neutral-700">
                  <li className="flex gap-2"><Icon.Check size={15} className="mt-0.5 shrink-0" /> Our lowest price</li>
                  <li className="flex gap-2"><Icon.Close size={15} className="mt-0.5 shrink-0 text-neutral-400" /> No refund if you cancel</li>
                  <li className="flex gap-2"><Icon.Close size={15} className="mt-0.5 shrink-0 text-neutral-400" /> No date changes</li>
                </ul>
              </div>
              <div className="rounded-2xl border-2 border-brand bg-cream p-5">
                <div className="text-[17px] font-semibold">Flexible</div>
                <div className="text-[13px] text-neutral-500">The package price + {money(FLEX_FEE)}</div>
                <ul className="mt-4 space-y-2 text-[13.5px] text-neutral-700">
                  <li className="flex gap-2"><Icon.Check size={15} className="mt-0.5 shrink-0" /> Cancel up to {FREE_CANCEL_HOURS}h before for a refund of the package price</li>
                  <li className="flex gap-2"><Icon.Check size={15} className="mt-0.5 shrink-0" /> One free date change</li>
                </ul>
              </div>
            </div>
            <button onClick={() => go('policy')} className="mt-4 text-[14px] font-semibold text-link">Read the cancellation policy</button>
          </div>
        </div>
      </section>

      {/* ---------- for photographers ---------- */}
      <section id="photographers" className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-2">
          <div>
            <p className="text-[13px] font-bold uppercase tracking-wider text-brand">For photographers</p>
            <h2 className="mt-3 font-display text-[28px] font-extrabold tracking-tight md:text-[34px]">Get booked. Get paid. Safely.</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-neutral-300">
              Clients pay upfront, so no more chasing deposits. You set your prices, your hours and the days you work.
            </p>
            <button onClick={joinAsPhotographer} className="mt-7 flex h-[52px] items-center gap-2 rounded-2xl bg-brand px-6 text-[15px] font-semibold text-ink">
              Create your studio <Icon.Arrow size={18} />
            </button>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              ['No monthly fees', '7% commission plus the payment fee, only when you are booked.'],
              ['Paid as you go', 'Up to 50% of your earnings is released as soon as the shoot is confirmed.'],
              ['Grow your level', 'Every 5 completed bookings raises your early payment from 30% to 40% to 50%.'],
              ['Protected dates', 'If a client cancels late or on the Saver rate, you keep your full earnings.'],
            ].map(([t, d]) => (
              <li key={t} className="rounded-2xl bg-white/5 p-5">
                <div className="text-[15px] font-semibold text-brand">{t}</div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-neutral-300">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section id="faq" className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="font-display text-[28px] font-extrabold tracking-tight md:text-[34px]">Questions</h2>
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-neutral-500">Booking a photographer</h3>
            <Faq items={FAQ_CLIENT} />
          </div>
          <div>
            <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-neutral-500">Working as a photographer</h3>
            <Faq items={FAQ_PHOTOGRAPHER} />
          </div>
        </div>
      </section>

      {/* ---------- final call + footer ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-14">
        <div className="flex flex-col items-start justify-between gap-5 rounded-3xl bg-brand p-8 md:flex-row md:items-center">
          <div>
            <h2 className="font-display text-[26px] font-extrabold tracking-tight">Ready for your moment?</h2>
            <p className="mt-1 text-[15px] text-ink/70">Find a photographer near you in a few minutes.</p>
          </div>
          <button onClick={() => findPhotographer()} className="flex h-[52px] items-center gap-2 rounded-2xl bg-ink px-6 text-[15px] font-semibold text-white">
            Find a photographer <Icon.Arrow size={18} />
          </button>
        </div>
      </section>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-[13px] text-neutral-500 md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} SnapshotZA · Made in South Africa</span>
          <div className="flex gap-5">
            <button onClick={() => go('policy')} className="hover:text-ink">Cancellations & refunds</button>
            <button onClick={joinAsPhotographer} className="hover:text-ink">Join as a photographer</button>
            <button onClick={signIn} className="hover:text-ink">Sign in</button>
          </div>
        </div>
      </footer>
    </div>
  )
}
