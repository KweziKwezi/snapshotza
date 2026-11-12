import { useEffect, useState } from 'react'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { DAYS_SHORT, FREE_CANCEL_HOURS, MONTHS } from '../data.js'
import { Button } from '../ui.jsx'

const prettyDay = (ymdStr) => {
  const d = new Date(`${ymdStr}T00:00:00`)
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}
export const prettyWhen = (day, time) => `${prettyDay(day)} at ${String(time).slice(0, 5)}`

/** Can this booking still have its date changed by the client? */
export function canChangeDate(b, now = Date.now()) {
  return b.status === 'confirmed' && b.rate_type === 'flexible' && (b.date_changes || 0) < 1
    && new Date(b.shoot_starts_at).getTime() - now >= FREE_CANCEL_HOURS * 3600000
}

/* ---------- Client: ask to move the shoot ---------- */
export function ClientReschedule({ b, request, onChanged }) {
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(null)       // { 'YYYY-MM-DD': freeSlots }
  const [day, setDay] = useState('')
  const [slots, setSlots] = useState(null)
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let off = false
    const from = new Date(Date.now() + (FREE_CANCEL_HOURS + 1) * 3600000)
    const to = new Date(from.getTime() + 90 * 86400000)
    const f = (d) => market.ymd(d.getFullYear(), d.getMonth(), d.getDate())
    market.getOpenDays(b.photographer_id, f(from), f(to), b.hours || 2)
      .then((d) => { if (!off) setDays(d) })
      .catch((e) => { if (!off) { setError(explain(e)); setDays({}) } })
    return () => { off = true }
  }, [open, b.photographer_id, b.hours])

  useEffect(() => {
    if (!day) return undefined
    let off = false
    setSlots(null)
    setTime('')
    market.getFreeSlots(b.photographer_id, day, b.hours || 2)
      .then((s) => { if (!off) { setSlots(s); setTime(s[0] || '') } })
      .catch((e) => { if (!off) { setError(explain(e)); setSlots([]) } })
    return () => { off = true }
  }, [day, b.photographer_id, b.hours])

  const run = async (key, fn) => {
    setBusy(key)
    setError('')
    try {
      await fn()
      setOpen(false)
      await onChanged()
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy('')
    }
  }

  if (request) {
    return (
      <div className="mt-3 rounded-xl bg-white p-3.5" data-testid="reschedule-pending">
        <div className="text-[13.5px] font-semibold">Date change requested</div>
        <p className="mt-1 text-[12.5px] text-neutral-600">Waiting for {b.photographerName} to approve moving your shoot to <b>{prettyWhen(request.new_date, request.new_time)}</b>. Until then your original date stands.</p>
        <button disabled={Boolean(busy)} onClick={() => run('cancel', () => market.cancelReschedule(request.id))} className="mt-2 text-[12.5px] font-semibold text-link disabled:opacity-50">{busy ? 'Cancelling…' : 'Cancel this request'}</button>
        {error && <p role="alert" className="mt-2 text-[12px] text-rose-700">{error}</p>}
      </div>
    )
  }
  if (!canChangeDate(b)) return null
  if (!open) {
    return <button onClick={() => setOpen(true)} className="mt-3 block text-[13px] font-semibold text-link">Change date (1 free change)</button>
  }
  const dayKeys = days ? Object.keys(days).filter((k) => days[k] > 0).sort() : []
  return (
    <div className="mt-3 rounded-xl bg-white p-3.5" data-testid="reschedule-form">
      <div className="text-[13.5px] font-semibold">Pick a new date</div>
      <p className="mt-1 text-[12px] text-neutral-600">Your photographer has to agree. You get one free date change, and the {FREE_CANCEL_HOURS}-hour refund cut-off moves with the new date.</p>
      {days === null && <p className="mt-2 text-[12.5px] text-neutral-500">Loading available days…</p>}
      {days && dayKeys.length === 0 && <p className="mt-2 text-[12.5px] text-neutral-500">No other days are open right now. Try again later.</p>}
      <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        {dayKeys.map((k) => (
          <button key={k} onClick={() => setDay(k)} aria-pressed={day === k} className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium ${day === k ? 'bg-ink text-white' : 'bg-surface text-neutral-700'}`}>{prettyDay(k)}</button>
        ))}
      </div>
      {day && slots === null && <p className="mt-2 text-[12.5px] text-neutral-500">Loading times…</p>}
      {day && slots && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Start time">
          {slots.map((t) => (
            <button key={t} role="radio" aria-checked={time === t} onClick={() => setTime(t)} className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium ${time === t ? 'bg-brand text-ink' : 'bg-surface text-neutral-700'}`}>{t}</button>
          ))}
          {slots.length === 0 && <span className="text-[12.5px] text-neutral-500">No free times that day.</span>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2.5 text-[12.5px] text-rose-700">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <Button arrow={false} disabled={!day || !time || Boolean(busy)} onClick={() => run('send', () => market.requestReschedule(b.id, day, time))}>{busy === 'send' ? 'Sending…' : 'Send request'}</Button>
        <button onClick={() => setOpen(false)} className="text-[13px] font-semibold text-neutral-500">Never mind</button>
      </div>
    </div>
  )
}

/* ---------- Photographer: approve or decline ---------- */
export function PhotographerReschedule({ b, request, onChanged }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [declining, setDeclining] = useState(false)
  if (!request) return null
  const run = async (key, approve) => {
    setBusy(key)
    setError('')
    try {
      await market.decideReschedule(request.id, approve, note.trim())
      await onChanged()
    } catch (e) {
      setError(explain(e))
      setBusy('')
    }
  }
  return (
    <div className="mt-3 rounded-xl bg-white p-3.5" data-testid="reschedule-request">
      <div className="text-[13.5px] font-semibold">{b.clientName} asked to move this shoot</div>
      <p className="mt-1 text-[12.5px] text-neutral-600">From <b>{prettyWhen(b.shoot_date, b.shoot_time)}</b> to <b>{prettyWhen(request.new_date, request.new_time)}</b>. Please answer within {FREE_CANCEL_HOURS} hours; if you do not, the request lapses and the booking stays as it is.</p>
      {declining && (
        <>
          <label htmlFor={`note-${request.id}`} className="mt-2 block text-[12px] font-semibold text-neutral-600">Reason (optional)</label>
          <input id={`note-${request.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="mt-1 w-full rounded-lg bg-surface p-2.5 text-[13px] outline-none" />
        </>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2.5 text-[12.5px] text-rose-700">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        {!declining && <Button arrow={false} disabled={Boolean(busy)} onClick={() => run('yes', true)}>{busy === 'yes' ? 'Approving…' : 'Approve'}</Button>}
        {declining
          ? <Button arrow={false} variant="dark" disabled={Boolean(busy)} onClick={() => run('no', false)}>{busy === 'no' ? 'Declining…' : 'Confirm decline'}</Button>
          : <button disabled={Boolean(busy)} onClick={() => setDeclining(true)} className="text-[13px] font-semibold text-rose-700">Decline</button>}
      </div>
    </div>
  )
}
