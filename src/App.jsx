import { useEffect } from 'react'
import { AppProvider, useApp } from './store.jsx'
import { Icon } from './ui.jsx'
import {
  Bookings, Chat, ChooseDate, Confirmed, Gateway, Home, PaymentMethod, Profile, Protection, Review, Splash,
} from './screens/Client.jsx'
import { Account, Auth, homeFor } from './screens/Auth.jsx'
import { AdminBanks, AdminList, AdminPayouts, AdminRefunds, AdminReport, AdminReports, AdminReview } from './screens/Admin.jsx'
import { Notifications } from './screens/Notifications.jsx'
import { Thread } from './screens/Chat.jsx'
import { Policy } from './screens/Policy.jsx'
import { Availability } from './screens/Calendar.jsx'
import { Earnings, StudioBookings } from './screens/Earnings.jsx'
import { supabaseConfigured } from './lib/supabase.js'
import { EditBank, EditPortfolio, EditProfile, MyPackages, OnbPackages, OnbPortfolio, OnbProfile, Payouts, Studio, Verify } from './screens/Studio.jsx'

const SCREENS = {
  splash: Splash,
  auth: Auth,
  account: Account,
  availability: Availability,
  earnings: Earnings,
  adminList: AdminList,
  adminReview: AdminReview,
  adminReports: AdminReports,
  adminPayouts: AdminPayouts,
  adminBanks: AdminBanks,
  adminRefunds: AdminRefunds,
  adminReport: AdminReport,
  notifications: Notifications,
  home: Home,
  profile: Profile,
  date: ChooseDate,
  review: Review,
  payment: PaymentMethod,
  protection: Protection,
  gateway: Gateway,
  confirmed: Confirmed,
  bookings: BookingsRoute,
  chat: Chat,
  thread: Thread,
  policy: Policy,
  studio: Studio,
  onbProfile: OnbProfile,
  onbPortfolio: OnbPortfolio,
  onbPackages: OnbPackages,
  myPackages: MyPackages,
  editProfile: EditProfile,
  editPortfolio: EditPortfolio,
  editBank: EditBank,
  payouts: Payouts,
  verify: Verify,
}

// Clients see their own bookings; photographers see the bookings they have received.
function BookingsRoute() {
  const { auth } = useApp()
  return auth.status === 'in' && auth.profile?.role === 'photographer' ? <StudioBookings /> : <Bookings />
}

const MENU = [
  ['Client', [
    ['splash', 'Welcome'], ['auth', 'Sign in / sign up', true], ['account', 'Account', true], ['notifications', 'Notifications', true], ['home', 'Home'], ['profile', 'Photographer profile'], ['date', 'Choose date'],
    ['review', 'Review & pay'], ['payment', 'Payment method', true], ['protection', 'Payment protection', true],
    ['gateway', 'Gateway hand-off (mock)', true], ['confirmed', 'Booking confirmed'], ['bookings', 'My bookings & escrow', true], ['chat', 'Chat'],
  ]],
  ['Photographer', [
    ['studio', 'Studio dashboard'], ['availability', 'Hours & availability', true], ['earnings', 'Earnings & withdrawals', true], ['onbProfile', 'Onboarding 1 · Profile'], ['onbPortfolio', 'Onboarding 2 · Portfolio'],
    ['onbPackages', 'Onboarding 3 · Packages'], ['myPackages', 'My packages (edit anytime)', true], ['editProfile', 'Edit profile', true], ['editPortfolio', 'Edit portfolio', true], ['editBank', 'Edit bank details', true], ['payouts', 'Onboarding 4 · Payouts (bank)', true], ['verify', 'Onboarding 5 · Verification'],
  ]],
  ['Admin', [['adminList', 'Photographer reviews', true], ['adminReview', 'Review one photographer', true], ['adminReports', 'Problem reports', true], ['adminReport', 'One problem report', true], ['adminPayouts', 'Payouts to send', true], ['adminBanks', 'Bank checks', true], ['adminRefunds', 'Refunds to send', true]]],
]

// The phone frame + screen menu is a design-review tool. It shows in local dev, or on the live site with ?preview.
const SHOW_PREVIEW = import.meta.env.DEV || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview'))

// Shown for a moment while we find out whether someone is already signed in (and while we hand them onward).
function Booting() {
  return (
    <div className="flex h-full items-center justify-center bg-ink text-brand">
      <Icon.Bolt size={64} sw={1.6} />
    </div>
  )
}

function Shell() {
  const { screen, jump, auth, state } = useApp()

  // The app always starts on the welcome screen (page load, refresh, or the link in a confirmation email).
  // A signed-in person should never be left there: send them to their own home instead.
  const signedInOnSplash = screen === 'splash' && auth.status === 'in'
  useEffect(() => {
    if (signedInOnSplash) jump(homeFor(auth))
  }, [signedInOnSplash, auth, jump])

  const Current = auth.status === 'loading' || signedInOnSplash ? Booting : SCREENS[screen]

  if (!SHOW_PREVIEW) {
    // Real app: full screen on phones, a centered mobile-width column on larger screens.
    return (
      <div className="mx-auto flex h-dvh w-full max-w-[480px] flex-col overflow-hidden bg-white md:shadow-[0_0_40px_rgba(0,0,0,0.12)]">
        {supabaseConfigured && state.sim && (
          <div role="status" className="shrink-0 bg-brand px-3 py-1 text-center text-[11px] font-bold tracking-wide text-ink">
            TEST MODE · payments and payouts are simulated
          </div>
        )}
        <div className="min-h-0 flex-1" key={screen}>
          <Current />
        </div>
      </div>
    )
  }

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
