import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseConfigured } from './lib/supabase.js'
import { loadAccount, signOut as apiSignOut } from './lib/auth.js'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const initial = {
  // client booking
  photographerId: 'thabo',
  packageId: 'signature',
  date: { y: 2026, m: 10, d: 21 },
  time: '14:00',
  favs: ['lerato'],
  payment: 'ozow', // 'ozow' | 'payfast'
  bookingStage: 'shoot_done', // paid -> shoot_done -> delivered -> released
  bookingRef: 'SZ-2048',
  paid: false,
  afterAuth: null, // screen to return to once the user has signed in
  // photographer
  studio: {
    name: 'Thabo Mokoena',
    city: 'Cape Town, Western Cape',
    specialty: 'Wedding & lifestyle',
    bio: 'Honest emotions. Beautiful light.\nLet’s turn your moments into forever.',
  },
  portfolio: [
    { id: 1, tone: 'green', src: '/photos/wedding-1.jpg' },
    { id: 2, tone: 'dusk', src: '/photos/wedding-2.jpg' },
    { id: 3, tone: 'cream', src: '/photos/wedding-3.jpg' },
    { id: 4, tone: 'warm', src: '/photos/wedding-4.jpg' },
  ],
  studioPackages: [
    { id: 'essential', name: 'Essential', price: 2500, hours: 2, photos: 40, delivery: 7 },
    { id: 'signature', name: 'Signature', price: 4500, hours: 4, photos: 100, delivery: 7 },
    { id: 'full', name: 'Full story', price: 7500, hours: 8, photos: 250, delivery: 10 },
  ],
  completedBookings: 3,
  rating: 4.9,
  bank: null, // { bank, holder, account, type, branch }
  verification: 'verified', // 'verified' | 'pending'
}

// status: 'loading' | 'out' | 'in'.  When Supabase is not configured the app stays in demo mode ('out').
const signedOut = { status: 'out', user: null, profile: null, photographer: null }

export function AppProvider({ children, start = 'splash' }) {
  const [stack, setStack] = useState([start])
  const [state, setState] = useState(initial)
  const [auth, setAuth] = useState(supabaseConfigured ? { ...signedOut, status: 'loading' } : signedOut)

  const set = useCallback((patch) => setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) })), [])
  const go = useCallback((screen) => setStack((st) => [...st, screen]), [])
  const back = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), [])
  const jump = useCallback((screen) => setStack([screen]), [])

  const refreshAccount = useCallback(async (user) => {
    if (!user) return setAuth(signedOut)
    const res = await loadAccount(user.id)
    setAuth({ status: 'in', user, profile: res.profile || null, photographer: res.photographer || null })
  }, [])

  // Keep the session in sync. (The callback must not await Supabase calls directly, so defer with setTimeout.)
  useEffect(() => {
    if (!supabaseConfigured) return undefined
    supabase.auth.getSession().then(({ data }) => refreshAccount(data.session?.user ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => refreshAccount(session?.user ?? null), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [refreshAccount])

  const signOut = useCallback(async () => {
    await apiSignOut()
    setAuth(signedOut)
    setStack(['home'])
  }, [])

  const value = useMemo(
    () => ({ screen: stack[stack.length - 1], state, set, go, back, jump, auth, refreshAccount, signOut }),
    [stack, state, set, go, back, jump, auth, refreshAccount, signOut],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
