import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { DAYS_SHORT, MONTHS, money } from '../data.js'
import { AppNav } from './Client.jsx'
import { Button, H1, Icon, Notice, Screen, TopBar } from '../ui.jsx'

const TestTag = () => <span className="rounded bg-ink px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-brand">TEST</span>
const ErrorNote = ({ error }) => (error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p> : null)

/* ---------- Earnings & withdrawals ---------- */
const PAYOUT_STATUS = {
  pending: ['Available', 'bg-emerald-50 text-ok'],
  processing: ['Processing', 'bg-cream text-amber-700'],
  completed: ['Paid', 'bg-surface text-neutral-600'],
  failed: ['Cancelled', 'bg-surface text-neutral-500'],
}
const PAYOUT_TYPE = { deposit_release: 'Early payment', final_release: 'Final payment' }

export function Earnings() {
  const { back, auth, state, go } = useApp()
  const approved = auth.photographer?.verification_status === 'approved'
  const [earn, setEarn] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const bank = state.bank

  const load = useCallback(async () => {
    try {
      const [e, h] = await Promise.all([market.myEarnings(), market.payoutHistory()])
      setEarn(e)
      setHistory(h)
    } catch (e) {
      setError(explain(e))
      setEarn((v) => v || { available: 0, processing: 0, paidOut: 0, inEscrow: 0, thisMonth: 0 })
      setHistory((v) => v || [])
    }
  }, [])
  useEffect(() => { if (approved) load() }, [approved, load])

  const withdraw = async () => {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await market.requestWithdrawal())
      await load()
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  if (!approved) {
    return (
      <Screen>
        <TopBar title="Earnings" onBack={back} />
        <div className="px-5 pt-6"><Notice tone="cream" title="Available once you’re approved">Your earnings appear here after your first booking.</Notice></div>
      </Screen>
    )
  }
  const available = earn?.available || 0
  return (
    <Screen>
      <TopBar title="Earnings" onBack={back} />
      <div className="px-5 pb-6">
        <div className="mt-2 rounded-3xl bg-ink p-5 text-white">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Available to withdraw</div>
          <div className="mt-1 font-display text-[40px] font-extrabold" data-testid="available">{money(available)}</div>
          <div className="mt-4">
            <Button disabled={busy || available <= 0 || !bank} onClick={withdraw}>{busy ? 'Withdrawing…' : available > 0 ? `Withdraw ${money(available)}` : 'Nothing to withdraw yet'}</Button>
          </div>
          <p className="mt-3 text-[12px] text-neutral-400">
            {state.sim ? 'Test mode: withdrawals complete instantly and no real money moves.' : 'Withdrawals are sent to your bank account by our team after you request them.'}
          </p>
        </div>

        {!bank && (
          <button onClick={() => go('payouts')} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-info p-4 text-left">
            <Icon.Bank size={22} className="text-link" />
            <div className="flex-1"><div className="text-[13px] font-semibold">Add your bank details</div><div className="text-[12px] text-neutral-600">Needed before you can withdraw.</div></div>
            <Icon.Chevron size={18} />
          </button>
        )}
        {bank && <p className="mt-3 flex items-center gap-2 text-[12.5px] text-neutral-600"><Icon.Bank size={15} /> Paid to {bank.bank} •••• {bank.account.slice(-4)}</p>}

        {result && (
          <Notice className="mt-4" icon={<Icon.Check size={18} />} title={result.completed ? `${money(result.total)} withdrawn` : `${money(result.total)} on its way`}>
            {result.completed
              ? <>Reference <b>{result.reference}</b>. This was a test withdrawal, so no real money moved.</>
              : 'We’ve received your request. Our team will send it to your bank account.'}
          </Notice>
        )}
        <ErrorNote error={error} />

        <div className="mt-5 grid grid-cols-2 gap-3">
          {[
            ['In escrow', earn?.inEscrow, 'Paid by clients, not yet released'],
            ['Processing', earn?.processing, 'Withdrawals being sent'],
            ['Paid out', earn?.paidOut, 'Sent to your bank'],
            ['This month', earn?.thisMonth, 'Released to you'],
          ].map(([label, value, hint]) => (
            <div key={label} className="rounded-2xl bg-surface p-3.5">
              <div className="text-[11px] text-neutral-500">{label}</div>
              <div className="font-display text-[20px] font-bold">{money(value || 0)}</div>
              <div className="text-[10.5px] text-neutral-400">{hint}</div>
            </div>
          ))}
        </div>

        <h2 className="mb-3 mt-7 font-display text-[18px] font-bold">Payment history</h2>
        {history === null && <p className="text-[13px] text-neutral-500">Loading…</p>}
        {history?.length === 0 && <p className="rounded-2xl bg-surface p-4 text-[13px] text-neutral-600">No payments yet. They appear here after a client has paid and the shoot is done.</p>}
        <div className="space-y-2.5">
          {history?.map((h) => {
            const [label, tone] = PAYOUT_STATUS[h.status] || [h.status, 'bg-surface']
            const d = new Date(h.created_at)
            return (
              <div key={h.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3.5">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-semibold">{PAYOUT_TYPE[h.type] || 'Payment'} {h.simulated && <TestTag />}</div>
                  <div className="text-[11.5px] text-neutral-500">{h.bookingRef} · {d.getDate()} {MONTHS[d.getMonth()].slice(0, 3)}{h.bank_reference ? ` · ${h.bank_reference}` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-[16px] font-bold">{money(h.amount)}</div>
                  <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${tone}`}>{label}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Screen>
  )
}

/* ---------- Photographer's bookings (the Bookings tab for photographers) ---------- */
const BOOKING_STATUS = {
  confirmed: ['Paid', 'bg-emerald-50 text-ok'],
  in_progress: ['Shoot done', 'bg-info text-link'],
  gallery_uploaded: ['Photos delivered', 'bg-info text-link'],
  completed: ['Completed', 'bg-surface text-neutral-600'],
  disputed: ['Under review', 'bg-rose-50 text-rose-700'],
}

function StudioBookingCard({ b, sim, onChanged }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [label, tone] = BOOKING_STATUS[b.status] || [b.status, 'bg-surface']
  const when = new Date(`${b.shoot_date}T00:00:00`)
  const shootOver = new Date(b.shoot_ends_at).getTime() <= Date.now()
  const testable = sim && b.simulated
  const run = async (key, fn) => {
    setBusy(key)
    setError('')
    try {
      await fn()
      await onChanged()
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold">{b.clientName}</div>
          <div className="text-[12px] text-neutral-500">{b.packageName} · {DAYS_SHORT[when.getDay()]} {when.getDate()} {MONTHS[when.getMonth()].slice(0, 3)} · {String(b.shoot_time).slice(0, 5)}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>
          {b.simulated && <TestTag />}
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between text-[12px] text-neutral-500">
        <span>{b.booking_ref}<br />Client paid {money(Number(b.total_amount))} · fees {money(Number(b.platform_fee) + Number(b.transaction_fee))}</span>
        <span className="text-right text-[11px]">You earn<br /><b className="font-display text-[17px] text-ink">{money(b.net)}</b></span>
      </div>

      {b.status === 'confirmed' && !shootOver && <p className="mt-3 text-[12px] text-neutral-600">Paid and held securely. Your first payment is released 24 hours after the shoot.</p>}
      {testable && b.status === 'confirmed' && !shootOver && (
        <div className="mt-3">
          <Button variant="soft" disabled={Boolean(busy)} onClick={() => run('done', () => market.simulateShootDone(b.id))}>{busy === 'done' ? 'Working…' : 'Test: the shoot is done'}</Button>
        </div>
      )}
      {(b.status === 'confirmed' || b.status === 'in_progress') && shootOver && (
        <>
          <p className="mt-3 text-[12px] text-neutral-600">{b.status === 'in_progress' ? 'Your first payment has been released. Deliver the photos to get the rest.' : 'Deliver the photos to get paid.'}</p>
          {testable ? (
            <div className="mt-3">
              <Button variant="soft" disabled={Boolean(busy)} onClick={() => run('deliver', () => market.simulateDelivery(b.id))}>{busy === 'deliver' ? 'Working…' : 'Test: deliver the photos'}</Button>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-neutral-500">Photo upload is coming soon.</p>
          )}
        </>
      )}
      {b.status === 'gallery_uploaded' && <p className="mt-3 text-[12px] text-neutral-600">Waiting for the client to approve. The rest is released when they approve, or automatically after 48 hours.</p>}
      {b.status === 'completed' && <p className="mt-3 text-[12px] text-neutral-600">All paid out. Withdraw it from Earnings.</p>}
      <ErrorNote error={error} />
    </div>
  )
}

export function StudioBookings() {
  const { auth, state, go } = useApp()
  const pid = auth.photographer?.id
  const approved = auth.photographer?.verification_status === 'approved'
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!pid) return
    setError('')
    try {
      setItems(await market.studioBookings(pid))
    } catch (e) {
      setError(explain(e))
      setItems([])
    }
  }, [pid])
  useEffect(() => { if (approved) load() }, [approved, load])

  return (
    <Screen nav={<AppNav active="bookings" />}>
      <div className="px-5 pt-3">
        <div className="flex items-end justify-between">
          <H1>Bookings</H1>
          {approved && <button onClick={() => go('earnings')} className="mb-1 text-[13px] font-semibold text-link">Earnings</button>}
        </div>
        {!approved && <Notice className="mt-5" tone="cream" title="Available once you’re approved">Your bookings appear here after your profile has been reviewed.</Notice>}
        <ErrorNote error={error} />
        {approved && items === null && <p className="mt-6 text-[13px] text-neutral-500">Loading…</p>}
        {approved && items?.length === 0 && !error && (
          <Notice className="mt-5" icon={<Icon.Calendar size={18} />} title="No bookings yet">When a client books and pays, it shows up here. Make sure you’ve opened some days in your calendar.</Notice>
        )}
        <div className="mt-5 space-y-3 pb-5">
          {items?.map((b) => <StudioBookingCard key={b.id} b={b} sim={state.sim} onChanged={load} />)}
        </div>
      </div>
    </Screen>
  )
}
