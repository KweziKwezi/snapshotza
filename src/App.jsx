import { AppProvider, useApp } from './store.jsx'
import {
  Bookings, Chat, ChooseDate, Confirmed, Gateway, Home, PaymentMethod, Profile, Protection, Review, Splash,
} from './screens/Client.jsx'
import { Account, Auth } from './screens/Auth.jsx'
import { OnbPackages, OnbPortfolio, OnbProfile, Payouts, Studio, Verify } from './screens/Studio.jsx'

const SCREENS = {
  splash: Splash,
  auth: Auth,
  account: Account,
  home: Home,
  profile: Profile,
  date: ChooseDate,
  review: Review,
  payment: PaymentMethod,
  protection: Protection,
  gateway: Gateway,
  confirmed: Confirmed,
  bookings: Bookings,
  chat: Chat,
  studio: Studio,
  onbProfile: OnbProfile,
  onbPortfolio: OnbPortfolio,
  onbPackages: OnbPackages,
  payouts: Payouts,
  verify: Verify,
}

const MENU = [
  ['Client', [
    ['splash', 'Welcome'], ['auth', 'Sign in / sign up', true], ['account', 'Account', true], ['home', 'Home'], ['profile', 'Photographer profile'], ['date', 'Choose date'],
    ['review', 'Review & pay'], ['payment', 'Payment method', true], ['protection', 'Payment protection', true],
    ['gateway', 'Gateway hand-off (mock)', true], ['confirmed', 'Booking confirmed'], ['bookings', 'My bookings & escrow', true], ['chat', 'Chat'],
  ]],
  ['Photographer', [
    ['studio', 'Studio dashboard'], ['onbProfile', 'Onboarding 1 · Profile'], ['onbPortfolio', 'Onboarding 2 · Portfolio'],
    ['onbPackages', 'Onboarding 3 · Packages'], ['payouts', 'Onboarding 4 · Payouts (bank)', true], ['verify', 'Onboarding 5 · Verification'],
  ]],
]

function Shell() {
  const { screen, jump } = useApp()
  const Current = SCREENS[screen]
  return (
    <div className="flex min-h-full items-center justify-center gap-10 md:p-6">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="mb-4 font-display text-xl font-extrabold">SnapshotZA <span className="text-sm font-medium text-neutral-500">prototype</span></div>
        {MENU.map(([group, items]) => (
          <div key={group} className="mb-5">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-500">{group}</div>
            {items.map(([id, label, isNew]) => (
              <button
                key={id}
                onClick={() => jump(id)}
                className={`mb-0.5 flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[13px] ${screen === id ? 'bg-brand font-semibold' : 'hover:bg-white/70'}`}
              >
                {label}
                {isNew && <span className="rounded bg-ink px-1.5 py-0.5 text-[9px] font-bold text-white">NEW</span>}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-white md:h-[844px] md:max-h-[calc(100dvh-3rem)] md:w-[390px] md:rounded-[44px] md:border-[10px] md:border-black md:shadow-2xl">
        <div className="hidden h-11 shrink-0 items-center justify-between px-7 text-[13px] font-semibold md:flex" style={{ background: screen === 'splash' ? '#0b0b0b' : '#fff', color: screen === 'splash' ? '#fff' : '#0b0b0b' }}>
          <span>9:41</span><span className="tracking-widest">••• ▬</span>
        </div>
        <div className="min-h-0 flex-1" key={screen}>
          <Current />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
