import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { AppNav } from './Client.jsx'
import { ago } from './Notifications.jsx'
import { Icon, Notice, Screen, TopBar, H1, initials } from '../ui.jsx'
import { CHAT_RETENTION_DAYS } from '../data.js'

const POLL_MS = 6000

const dayLabel = (iso) => {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(today.getTime() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
}
const clock = (iso) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })

/** A small button on a booking card that opens its chat. Only for bookings that have been paid. */
export function MessageButton({ b }) {
  const { go, set } = useApp()
  if (!['confirmed', 'in_progress', 'gallery_uploaded', 'completed', 'disputed'].includes(b.status)) return null
  return (
    <button onClick={() => { set({ chatBooking: b.id }); go('thread') }} className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-link">
      <Icon.Message size={15} /> Message
    </button>
  )
}

/* ---------- The Messages tab: one row per paid booking ---------- */
export function Messages() {
  const { auth, go, set, state, refreshUnread } = useApp()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setItems(await market.listConversations())
      setError('')
    } catch (e) {
      setError(explain(e))
      setItems((v) => v || [])
    }
  }, [])
  useEffect(() => {
    if (auth.status !== 'in') return undefined
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [auth.status, load])

  if (auth.status !== 'in') {
    return (
      <Screen nav={<AppNav active="messages" />}>
        <div className="px-5 pt-3"><H1>Messages</H1><p className="mt-2 text-[14px] text-neutral-600">Sign in to message your photographer or client.</p></div>
      </Screen>
    )
  }
  return (
    <Screen nav={<AppNav active="messages" />}>
      <div className="px-5 pt-3">
        <H1>Messages</H1>
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {items === null && <p className="mt-6 text-[13px] text-neutral-500">Loading…</p>}
        {items?.length === 0 && !error && (
          <Notice className="mt-5" icon={<Icon.Message size={18} />} title="Chat opens after a booking is paid">
            Once a booking is paid, you and your {auth.profile?.role === 'photographer' ? 'client' : 'photographer'} can message here to agree the location, timing and what to wear.
          </Notice>
        )}
        <div className="mt-4 space-y-2.5 pb-4">
          {items?.map((c) => (
            <button
              key={c.booking_id}
              onClick={() => { set({ chatBooking: c.booking_id }); go('thread'); refreshUnread?.() }}
              className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3.5 text-left"
              data-unread={c.unread > 0}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-[13px] font-semibold">
                {c.other_photo ? <img src={c.other_photo} alt="" className="h-full w-full object-cover" /> : initials(c.other_name || '?')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-[14.5px] ${c.unread > 0 ? 'font-bold' : 'font-semibold'}`}>{c.other_name || 'Chat'}</span>
                  <span className="shrink-0 text-[11px] text-neutral-400">{ago(c.last_at)}</span>
                </span>
                <span className="block truncate text-[12px] text-neutral-500">{c.booking_ref} · {c.shoot_date}{c.status === 'cancelled' ? ' · cancelled' : ''}</span>
                <span className={`block truncate text-[12.5px] ${c.unread > 0 ? 'font-semibold text-ink' : 'text-neutral-600'}`}>
                  {c.last_message ? `${c.last_from_me ? 'You: ' : ''}${c.last_message}` : 'Say hello'}
                </span>
              </span>
              {c.unread > 0 && <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white" aria-label={`${c.unread} unread`}>{c.unread}</span>}
            </button>
          ))}
        </div>
      </div>
    </Screen>
  )
}

/* ---------- One conversation ---------- */
export function Thread({ embedded = false }) {
  const { auth, back, state, refreshUnread } = useApp()
  const bookingId = state.chatBooking
  const me = auth.user?.id
  const [info, setInfo] = useState(null)
  const [msgs, setMsgs] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const end = useRef(null)
  const seen = useRef(new Set())

  const merge = useCallback((incoming) => {
    setMsgs((cur) => {
      const have = new Map((cur || []).map((m) => [m.id, m]))
      for (const m of incoming) have.set(m.id, m)
      return [...have.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    })
  }, [])
  const markRead = useCallback(async () => {
    await market.markChatRead(bookingId)
    refreshUnread?.()
  }, [bookingId, refreshUnread])

  useEffect(() => {
    if (!bookingId || !me) return undefined
    let off = false
    const pull = async () => {
      try {
        const list = await market.loadMessages(bookingId)
        if (off) return
        const fresh = list.some((m) => !seen.current.has(m.id) && m.sender_id !== me && m.message_type !== 'system')
        list.forEach((m) => seen.current.add(m.id))
        merge(list)
        setError('')
        if (fresh) markRead()
      } catch (e) {
        if (!off) { setError(explain(e)); setMsgs((v) => v || []) }
      }
    }
    pull().then(() => { if (!off) markRead() })
    market.listConversations().then((l) => { if (!off) setInfo(l.find((c) => c.booking_id === bookingId) || null) }).catch(() => {})
    const stop = market.watchMessages(bookingId, (m) => {
      if (off) return
      seen.current.add(m.id)
      merge([m])
      if (m.sender_id !== me && m.message_type !== 'system') markRead()
    })
    const timer = setInterval(pull, POLL_MS)
    return () => { off = true; stop(); clearInterval(timer) }
  }, [bookingId, me, merge, markRead])

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs?.length])

  const closed = info?.status === 'cancelled'
  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    setError('')
    try {
      const m = await market.sendMessage(bookingId, me, t)
      seen.current.add(m.id)
      merge([m])
      setText('')
    } catch (e) {
      setError(explain(e))
    } finally {
      setSending(false)
    }
  }
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  if (!bookingId) return <Messages />
  let lastDay = ''
  return (
    <Screen
      footer={closed ? (
        <p className="text-center text-[13px] text-neutral-500">This booking was cancelled, so the chat is closed.</p>
      ) : (
        <div>
          {error && <p role="alert" className="mb-2 rounded-xl bg-rose-50 p-2.5 text-[12.5px] text-rose-700">{error}</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              maxLength={2000}
              aria-label="Write a message"
              placeholder="Write a message…"
              className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl bg-surface px-4 py-3 text-[14px] outline-none"
            />
            <button onClick={send} disabled={!text.trim() || sending} aria-label="Send message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-ink disabled:opacity-40">
              <Icon.Arrow size={20} />
            </button>
          </div>
        </div>
      )}
    >
      <TopBar title={info?.other_name || 'Chat'} onBack={embedded ? undefined : back} />
      {info && <p className="px-5 text-[12px] text-neutral-500">{info.booking_ref} · {info.shoot_date} · {String(info.shoot_time).slice(0, 5)}</p>}
      <p className="px-5 text-[11.5px] text-neutral-400">Messages are deleted after {CHAT_RETENTION_DAYS} days.</p>
      <div className="px-4 pb-3 pt-2" data-testid="thread">
        {msgs === null && <p className="mt-6 text-center text-[13px] text-neutral-500">Loading…</p>}
        {msgs?.length === 0 && <p className="mt-8 text-center text-[13px] text-neutral-500">No messages yet. Say hello and agree the details of your shoot.</p>}
        {msgs?.map((m) => {
          const day = dayLabel(m.created_at)
          const header = day !== lastDay ? <div key={`d-${m.id}`} className="my-3 text-center text-[11px] font-semibold text-neutral-400">{day}</div> : null
          lastDay = day
          if (m.message_type === 'system') {
            return <div key={m.id}>{header}<p className="mx-auto my-2 max-w-[85%] rounded-xl bg-surface px-3 py-2 text-center text-[11.5px] text-neutral-500">{m.content}</p></div>
          }
          const mine = m.sender_id === me
          return (
            <div key={m.id}>
              {header}
              <div className={`my-1 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug ${mine ? 'rounded-br-md bg-brand text-ink' : 'rounded-bl-md bg-surface text-ink'}`} data-mine={mine}>
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                  <span className="mt-0.5 block text-right text-[10px] text-neutral-500">{clock(m.created_at)}</span>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
    </Screen>
  )
}
