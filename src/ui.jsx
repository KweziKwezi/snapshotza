import { useCallback, useEffect, useRef, useState } from 'react'

/* ---------- Icons ---------- */
const I = ({ children, size = 20, className = '', fill = 'none', sw = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
)
export const Icon = {
  Back: (p) => <I {...p}><path d="M15 18l-6-6 6-6" /></I>,
  Arrow: (p) => <I {...p}><path d="M5 12h14M13 6l6 6-6 6" /></I>,
  Chevron: (p) => <I {...p}><path d="M9 6l6 6-6 6" /></I>,
  ChevronL: (p) => <I {...p}><path d="M15 6l-6 6 6 6" /></I>,
  Lock: (p) => <I {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></I>,
  Bell: (p) => <I {...p}><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" /><path d="M10 21h4" /></I>,
  Pin: (p) => <I {...p}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></I>,
  Search: (p) => <I {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></I>,
  Heart: ({ filled, ...p }) => <I {...p} fill={filled ? 'currentColor' : 'none'} className={filled ? 'text-rose-600' : ''}><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.6 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z" /></I>,
  Check: (p) => <I {...p} sw={2.4}><path d="M5 12.5l4.5 4.5L19 7.5" /></I>,
  Home: (p) => <I {...p}><path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z" /></I>,
  Message: (p) => <I {...p}><path d="M4 5h16v11H9l-5 4z" /></I>,
  Calendar: (p) => <I {...p}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></I>,
  User: (p) => <I {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0115 0" /></I>,
  Plus: (p) => <I {...p}><path d="M12 5v14M5 12h14" /></I>,
  Close: (p) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>,
  Camera: (p) => <I {...p}><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></I>,
  IdCard: (p) => <I {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6.5 16c.5-1.6 1.6-2.3 2.5-2.3s2 .7 2.5 2.3M14 10h4M14 13h3" /></I>,
  Bank: (p) => <I {...p}><path d="M3 9l9-5 9 5M5 9v8M9.5 9v8M14.5 9v8M19 9v8M3 20h18" /></I>,
  Card: (p) => <I {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></I>,
  Shield: (p) => <I {...p}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></I>,
  Star: (p) => <I {...p} fill="currentColor" sw={0}><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.4 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" /></I>,
  Eye: (p) => <I {...p}><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></I>,
  Bolt: (p) => <I {...p}><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="12" r="6.2" /><path d="M13 7l-3.5 5.5H12L11 17l3.5-5.5H12z" fill="currentColor" /></I>,
}

/* ---------- Photos (real image if present, else tonal placeholder) ---------- */
const TONES = {
  warm: 'linear-gradient(135deg,#e6b27a 0%,#a9693b 55%,#5c3a22 100%)',
  rust: 'linear-gradient(135deg,#d97a4e 0%,#9a3f22 60%,#3b1a12 100%)',
  cool: 'linear-gradient(135deg,#9db4c8 0%,#5b7691 60%,#2b3a4b 100%)',
  dusk: 'linear-gradient(135deg,#f0b27a 0%,#8a5a7a 55%,#2a2540 100%)',
  green: 'linear-gradient(135deg,#a8c08a 0%,#5e7f4a 60%,#2a3b22 100%)',
  sand: 'linear-gradient(135deg,#efdcc0 0%,#c9a47a 60%,#7a5a3a 100%)',
  cream: 'linear-gradient(135deg,#f7efe2 0%,#e3d2b6 60%,#b79d78 100%)',
}
export const initials = (name = '') => name.split(' ').map((w) => w[0]).slice(0, 2).join('')

export function Photo({ src, tone = 'warm', className = '', label, children, alt = '' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: TONES[tone] || TONES.warm }}>
      {label && <span className="absolute inset-0 flex items-center justify-center font-display text-lg font-bold text-white/70">{label}</span>}
      {src && !failed && <img src={src} alt={alt} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />}
      {children}
    </div>
  )
}
export const Avatar = ({ person, size = 44 }) => (
  <div style={{ width: size, height: size, fontSize: size * 0.3 }} className="shrink-0 overflow-hidden rounded-full">
    <Photo src={person.avatar} tone={person.tone} label={initials(person.name)} className="h-full w-full" alt={person.name} />
  </div>
)

/* ---------- Layout ---------- */
export function Screen({ children, footer, nav, dark = false }) {
  return (
    <div className={`flex h-full min-h-0 flex-col ${dark ? 'bg-ink text-white' : 'bg-white'}`}>
      <div className="scroll-hide min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="px-5 pb-3 pt-2">{footer}</div>}
      {nav}
    </div>
  )
}

export function TopBar({ title, onBack, right, avatar }) {
  return (
    <div className="flex h-12 items-center gap-3 px-5">
      {onBack && (
        <button onClick={onBack} aria-label="Back" className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full">
          <Icon.Back />
        </button>
      )}
      {avatar}
      <div className="flex-1 font-display text-[15px] font-semibold">{title}</div>
      {right}
    </div>
  )
}

export function Stepper({ steps, current, left, right }) {
  return (
    <div className="px-5">
      <div className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: steps }).map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i < current ? 'bg-brand' : 'bg-line'}`} />
        ))}
      </div>
    </div>
  )
}

export const H1 = ({ children, className = '' }) => (
  <h1 className={`font-display text-[30px] font-extrabold leading-[1.1] tracking-tight ${className}`}>{children}</h1>
)

/* ---------- Controls ---------- */
export function Button({ children, onClick, disabled, variant = 'brand', arrow = true, className = '' }) {
  const styles = {
    brand: 'bg-brand text-ink',
    soft: 'bg-surface text-ink',
    dark: 'bg-ink text-white',
  }[variant]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-[52px] w-full items-center justify-between rounded-2xl px-5 text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-45 ${styles} ${className}`}
    >
      <span>{children}</span>
      {arrow && <Icon.Arrow size={20} />}
    </button>
  )
}

export function Field({ label, children, hint, error }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-neutral-500">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-neutral-500">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-rose-600">{error}</span>}
    </label>
  )
}
export const inputCls =
  'h-12 w-full rounded-xl bg-surface px-4 text-[14px] outline-none ring-2 ring-transparent transition placeholder:text-neutral-400 focus:ring-brand'

export function Segmented({ options, value, onChange }) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`h-12 flex-1 rounded-2xl text-[14px] font-semibold ${value === o.value ? 'bg-ink text-white' : 'bg-surface text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Notice({ icon, title, children, tone = 'info', className = '' }) {
  const bg = tone === 'info' ? 'bg-info' : tone === 'cream' ? 'bg-cream' : 'bg-surface'
  return (
    <div className={`flex gap-3 rounded-2xl p-3.5 ${bg} ${className}`}>
      {icon && <div className="mt-0.5 text-link">{icon}</div>}
      <div className="text-[12px] leading-snug text-neutral-600">
        {title && <div className="mb-0.5 text-[13px] font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  )
}

export function Checkbox({ checked, onChange, children }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-start gap-3 text-left" role="checkbox" aria-checked={checked}>
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${checked ? 'bg-ink text-white' : 'border border-neutral-300 bg-white'}`}>
        {checked && <Icon.Check size={13} />}
      </span>
      <span className="text-[12.5px] leading-snug text-ink">{children}</span>
    </button>
  )
}

/* ---------- Bottom nav ---------- */
const TABS = [
  { id: 'home', label: 'Home', icon: Icon.Home },
  { id: 'messages', label: 'Messages', icon: Icon.Message },
  { id: 'bookings', label: 'Bookings', icon: Icon.Calendar },
  { id: 'profile', label: 'Profile', icon: Icon.User },
]
export function BottomNav({ active, onSelect }) {
  return (
    <nav className="flex justify-around border-t border-line bg-white px-2 pb-2 pt-2">
      {TABS.map((t) => {
        const on = t.id === active
        const Ic = t.icon
        return (
          <button key={t.id} onClick={() => onSelect(t.id)} className="flex w-16 flex-col items-center gap-1">
            <span className={`flex h-8 w-10 items-center justify-center rounded-xl ${on ? 'bg-brand text-ink' : 'text-neutral-500'}`}>
              <Ic size={20} />
            </span>
            <span className={`text-[10px] ${on ? 'font-semibold text-ink' : 'text-neutral-500'}`}>{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ---------- Full-screen photo viewer ---------- */
// photos: [{ id, src (small), full (large), tone }]. Swipe, arrow keys or the buttons to move; Esc or X to close.
export function Lightbox({ photos, index, onClose, onIndex }) {
  const count = photos.length
  const touch = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const step = useCallback((d) => onIndex((index + d + count) % count), [index, count, onIndex])
  const photo = photos[index]

  useEffect(() => { setLoaded(false) }, [index])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose, step])
  // Warm the cache for the neighbours so swiping feels instant.
  useEffect(() => {
    for (const d of [1, -1]) {
      const n = photos[(index + d + count) % count]
      if (n?.full) { const im = new Image(); im.src = n.full }
    }
  }, [index, count, photos])

  const onTouchStart = (e) => { touch.current = e.touches[0].clientX }
  const onTouchEnd = (e) => {
    if (touch.current == null) return
    const dx = e.changedTouches[0].clientX - touch.current
    touch.current = null
    if (Math.abs(dx) > 50 && count > 1) step(dx < 0 ? 1 : -1)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${count}`}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[13px] font-medium text-white/80" aria-live="polite">{index + 1} / {count}</span>
        <button onClick={onClose} aria-label="Close" autoFocus className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
          <Icon.Close size={20} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
        {photo.full || photo.src ? (
          <>
            {/* the small version shows instantly, the large one fades in over it */}
            {photo.src && <img src={photo.src} alt="" aria-hidden="true" className="absolute max-h-full max-w-full object-contain blur-sm" />}
            <img
              key={photo.id}
              src={photo.full || photo.src}
              alt={`Portfolio photo ${index + 1}`}
              onLoad={() => setLoaded(true)}
              className={`relative max-h-full max-w-full object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </>
        ) : (
          <Photo tone={photo.tone} className="h-[60vh] w-full max-w-md" />
        )}
        {count > 1 && (
          <>
            <button onClick={() => step(-1)} aria-label="Previous photo" className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50"><Icon.ChevronL size={22} /></button>
            <button onClick={() => step(1)} aria-label="Next photo" className="absolute right-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50"><Icon.Chevron size={22} /></button>
          </>
        )}
      </div>
      <div className="px-4 pb-4 pt-2 text-center text-[11px] text-white/50">{count > 1 ? 'Swipe or use the arrows' : ' '}</div>
    </div>
  )
}

/* ---------- Notification bell with an unread badge ---------- */
export function NotificationBell({ count = 0, onClick, className = '' }) {
  return (
    <button onClick={onClick} aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'} className={`relative ${className}`}>
      <Icon.Bell size={22} />
      {count > 0 && (
        <span data-testid="unread-badge" className="absolute -right-1.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}
