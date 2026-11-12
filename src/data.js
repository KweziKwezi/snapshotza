// Whole rand amounts show as R4,500; amounts with cents always show two decimals (R2,287.50, never R2,287.5).
export const money = (n) => {
  const v = Number(n)
  const whole = Number.isInteger(v)
  return 'R' + v.toLocaleString('en-US', whole ? undefined : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// What a photographer can specialise in (stored as photographer_profiles.specialties).
export const SPECIALTIES = ['Matric', 'Wedding', 'Corporate', 'Events', 'Newborn', 'Real estate']
export const CATEGORIES = ['All', ...SPECIALTIES]

export const PHOTOGRAPHERS = [
  { id: 'thabo', name: 'Thabo Mokoena', style: 'Wedding', tagline: 'Wedding & lifestyle photographer', rating: 4.9, reviews: 128, from: 2500, city: 'Cape Town', tone: 'warm', cover: '/photos/wedding-1.jpg', avatar: '/photos/thabo.jpg', bio: 'Honest emotions. Beautiful light. I turn your once-in-a-lifetime moments into forever.' },
  { id: 'lerato', name: 'Lerato Nkosi', style: 'Matric', tagline: 'Matric & portrait photographer', rating: 4.8, reviews: 74, from: 1200, city: 'Johannesburg', tone: 'rust', cover: '/photos/matric-1.jpg', avatar: '/photos/lerato.jpg', bio: 'Bold colour, confident frames. Your matric dance, shot like a magazine cover.' },
  { id: 'nomsa', name: 'Nomsa Dlamini', style: 'Corporate', tagline: 'Corporate & headshot photographer', rating: 4.9, reviews: 96, from: 1800, city: 'Durban', tone: 'cool', cover: '/photos/corporate-1.jpg', avatar: '/photos/nomsa.jpg', bio: 'Professional portraits and team shoots that make your brand look its best.' },
  { id: 'daniel', name: 'Daniel Jacobs', style: 'Events', tagline: 'Events & celebration photographer', rating: 4.9, reviews: 61, from: 2000, city: 'Cape Town', tone: 'dusk', cover: '/photos/events-1.jpg', avatar: '/photos/daniel.jpg', bio: 'Parties, launches and everything in between. I capture the energy of the room.' },
]

export const packagesFor = (p) => {
  if (p.id === 'thabo') {
    return [
      { id: 'essential', name: 'Essential', price: 2500, hours: 2, photos: 40, delivery: 7 },
      { id: 'signature', name: 'Signature', price: 4500, hours: 4, photos: 100, delivery: 7, popular: true },
      { id: 'full', name: 'Full story', price: 7500, hours: 8, photos: 250, delivery: 10 },
    ]
  }
  const r = (n) => Math.round(n / 50) * 50
  return [
    { id: 'essential', name: 'Essential', price: p.from, hours: 1, photos: 20, delivery: 5 },
    { id: 'signature', name: 'Signature', price: r(p.from * 1.8), hours: 3, photos: 60, delivery: 7, popular: true },
    { id: 'full', name: 'Full story', price: r(p.from * 3), hours: 6, photos: 150, delivery: 10 },
  ]
}

// Design date: the app is shown as if today is 9 Nov 2026.
export const TODAY = new Date(2026, 10, 9)
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
export const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
export const TIMES = ['09:00', '14:00', '17:00']

export const isAvailable = (y, m, d) => {
  const date = new Date(y, m, d)
  if (date <= TODAY) return false
  if (y === 2026 && m === 10) return [12, 14, 18, 21, 24, 26, 28].includes(d)
  return (d + m) % 3 !== 0
}

// Fees (5% platform + ~3.5% gateway) are deducted from the photographer's side, never added to the client's price.
// Mirrors supabase/migrations: platform_settings. Keep in sync.
export const PLATFORM_FEE_RATE = 0.05
export const TRANSACTION_FEE_RATE = 0.035

// Universal branch codes — confirm against your payment partner before launch.
export const BANKS = [
  { name: 'FNB', branch: '250655' },
  { name: 'Standard Bank', branch: '051001' },
  { name: 'Absa', branch: '632005' },
  { name: 'Nedbank', branch: '198765' },
  { name: 'Capitec', branch: '470010' },
  { name: 'Discovery Bank', branch: '679000' },
  { name: 'TymeBank', branch: '678910' },
  { name: 'African Bank', branch: '430000' },
  { name: 'Investec', branch: '580105' },
]

// ---- Trust tiers: every 5 completed bookings unlocks a bigger deposit, released 24h after the shoot ----
export const BOOKINGS_PER_TIER = 5
export const TIER_DEPOSIT_PCT = { 1: 30, 2: 40, 3: 50 }
export const MAX_TIER = 3
export const tierFor = (completed) => Math.min(MAX_TIER, 1 + Math.floor(completed / BOOKINGS_PER_TIER))
export const MIN_PORTFOLIO_PHOTOS = 5

// ---- Payment methods (hosted by the gateway — the app never sees card numbers) ----
export const PAY_METHODS = [
  { id: 'ozow', label: 'Instant EFT', provider: 'Ozow', desc: 'Pay straight from your banking app. Lowest fees.', tag: 'Recommended' },
  { id: 'payfast', label: 'Card & more', provider: 'PayFast', desc: 'Visa, Mastercard, Capitec Pay and other options.' },
]

// Final (full-res) photos are deleted this many days after delivery. Mirrors platform_settings.gallery_retention_days.
export const GALLERY_RETENTION_DAYS = 15
export const CHAT_RETENTION_DAYS = 20
export const FLEX_FEE = 150 // extra price of the Flexible rate (never refunded) - keep in step with platform_settings.flexible_fee
export const FREE_CANCEL_HOURS = 48
export const REFUND_DAYS = 14
