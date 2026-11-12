import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { AppNav } from './Client.jsx'
import { Icon, Notice, Screen, TopBar } from '../ui.jsx'

const ICON = {
  payout_queued: Icon.Bank,
  payout_processing: Icon.Bank,
  payout_sent: Icon.Check,
  confirm_shoot: Icon.Camera,
  new_booking: Icon.Calendar,
  chat_message: Icon.Message,
  strike: Icon.Shield,
  reschedule_request: Icon.Calendar,
  reschedule_approved: Icon.Calendar,
  reschedule_declined: Icon.Calendar,
  refund_sent: Icon.Card,
  booking_cancelled: Icon.Close,
  issue_received: Icon.Shield,
  issue_reported: Icon.Shield,
  issue_resolved: Icon.Shield,
  dispute_opened: Icon.Shield,
}

/** "5 min ago", "3 h ago", "12 Nov". */
export function ago(iso, now = Date.now()) {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

export function Notifications() {
  const { auth, go, back, set, refreshUnread } = useApp()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const isAdmin = auth.profile?.role === 'admin'

  const load = useCallback(async () => {
    try {
      const list = await market.listNotifications()
      setItems(list)
      // Opening the screen counts as reading them (the ones that were unread stay highlighted on this visit).
      if (list.some((n) => !n.read_at)) {
        await market.markAllRead()
        set({ unread: 0 })
        refreshUnread?.()
      }
    } catch (e) {
      setError(explain(e))
      setItems((v) => v || [])
    }
  }, [set, refreshUnread])
  useEffect(() => { if (auth.status === 'in') load() }, [auth.status, load])

  const open = (n) => {
    if (n.type === 'dispute_opened' && isAdmin) return go('adminReports')
    if (n.type === 'chat_message' && n.booking_id) {
      set({ chatBooking: n.booking_id })
      return go('thread')
    }
    if (n.booking_id) return go('bookings')
  }

  return (
    <Screen nav={<AppNav active={auth.profile?.role === 'photographer' ? 'bookings' : 'home'} />}>
      <TopBar title="Notifications" onBack={back} />
      <div className="px-5 pb-6">
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {items === null && <p className="mt-6 text-[13px] text-neutral-500">Loading…</p>}
        {items?.length === 0 && !error && (
          <Notice className="mt-5" icon={<Icon.Bell size={18} />} title="Nothing yet">
            We’ll tell you here when a booking is made, a shoot needs confirming, or a payment is queued, being sent or sent.
          </Notice>
        )}
        <p className="mb-3 text-[12px] text-neutral-500">These show in the app only for now. Email and SMS alerts are coming.</p>
        <div className="space-y-2.5">
          {items?.map((n) => {
            const I = ICON[n.type] || Icon.Bell
            const unread = !n.read_at
            return (
              <button key={n.id} onClick={() => open(n)} data-unread={unread} className={`flex w-full items-start gap-3 rounded-2xl p-3.5 text-left ${unread ? 'bg-info' : 'bg-surface'}`}>
                <span className="mt-0.5 shrink-0 text-link"><I size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold">{n.title}</span>
                  {n.body && <span className="mt-0.5 block text-[12.5px] leading-snug text-neutral-600">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-neutral-400">{ago(n.created_at)}</span>
                </span>
                {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-600" aria-label="Unread" />}
              </button>
            )
          })}
        </div>
      </div>
    </Screen>
  )
}
