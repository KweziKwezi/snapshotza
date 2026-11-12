import { useState } from 'react'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { DAYS_SHORT, MONTHS } from '../data.js'
import { Button } from '../ui.jsx'

/** "Sat 14 Nov at 10:00", from the booking's own date and time (no timezone guesswork). */
export function startLabel(b) {
  const d = new Date(`${b.shoot_date}T00:00:00`)
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} at ${String(b.shoot_time).slice(0, 5)}`
}
export const hasStarted = (b, now = Date.now()) => new Date(b.shoot_starts_at).getTime() <= now

/** Bookings that can still have a problem reported on them. */
export const canReport = (b) => ['confirmed', 'in_progress', 'gallery_uploaded'].includes(b.status)

const CLIENT_REASONS = [
  ['photographer_no_show', 'The photographer did not show up', true],
  ['not_delivered', 'My photos were not delivered', true],
  ['poor_quality', 'The photos are not what we agreed', false],
  ['other', 'Something else', false],
]
const PHOTOGRAPHER_REASONS = [
  ['client_no_show', 'The client did not show up', true],
  ['other', 'Something else', false],
]

/** "Report a problem": pick what happened, describe it. Payments on the booking are put on hold until our team decides. */
export function ReportForm({ b, role, onDone, onCancel }) {
  const started = hasStarted(b)
  const reasons = (role === 'photographer' ? PHOTOGRAPHER_REASONS : CLIENT_REASONS).filter(([, , needsStart]) => started || !needsStart)
  const [type, setType] = useState(reasons[0][0])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ok = text.trim().length >= 10

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await market.reportIssue(b.id, type, text.trim())
      await onDone()
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-white p-3.5" data-testid="report-form">
      <div className="text-[13.5px] font-semibold">Report a problem</div>
      <p className="mt-1 text-[12px] text-neutral-600">Payments on this booking are put on hold while our team looks into it. We’ll tell you what we decide.</p>
      <fieldset className="mt-3 space-y-1.5">
        <legend className="sr-only">What happened?</legend>
        {reasons.map(([id, label]) => (
          <label key={id} className="flex items-center gap-2 text-[13px]">
            <input type="radio" name={`reason-${b.id}`} checked={type === id} onChange={() => setType(id)} className="accent-black" />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="mt-3 block text-[12px] font-semibold text-neutral-600" htmlFor={`desc-${b.id}`}>Tell us what happened</label>
      <textarea
        id={`desc-${b.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="A few sentences is plenty."
        className="mt-1 w-full rounded-lg bg-surface p-2.5 text-[13px] outline-none"
      />
      {!ok && text.length > 0 && <p className="mt-1 text-[11.5px] text-neutral-500">Please write at least 10 characters.</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2.5 text-[12.5px] text-rose-700">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={!ok || busy} arrow={false} onClick={send}>{busy ? 'Sending…' : 'Send report'}</Button>
        <button onClick={onCancel} disabled={busy} className="text-[13px] font-semibold text-neutral-500">Never mind</button>
      </div>
    </div>
  )
}

/** A small "Report a problem" link that opens the form inline. */
export function ReportLink({ b, role, onChanged }) {
  const [open, setOpen] = useState(false)
  if (!canReport(b)) return null
  if (open) return <ReportForm b={b} role={role} onCancel={() => setOpen(false)} onDone={async () => { setOpen(false); await onChanged() }} />
  return <button onClick={() => setOpen(true)} className="mt-3 block text-[12.5px] font-semibold text-rose-700">Report a problem</button>
}
