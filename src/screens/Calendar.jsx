import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store.jsx'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { MONTHS } from '../data.js'
import { Button, H1, Icon, Notice, Screen, TopBar } from '../ui.jsx'

const todayParts = () => {
  const t = new Date()
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }
}

/** The photographer chooses which days clients may book. A day with a booking cannot be closed from here. */
export function Availability() {
  const { back, auth } = useApp()
  const pid = auth.photographer?.id
  const approved = auth.photographer?.verification_status === 'approved'
  const now = useMemo(todayParts, [])
  const [view, setView] = useState({ y: now.y, m: now.m })
  const [cal, setCal] = useState(null)               // { open: Set, booked: Set } for the visible month
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const first = new Date(view.y, view.m, 1).getDay()
  const days = new Date(view.y, view.m + 1, 0).getDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const key = (d) => market.ymd(view.y, view.m, d)
  const isPast = (d) => view.y < now.y || (view.y === now.y && (view.m < now.m || (view.m === now.m && d <= now.d)))
  const monthIndex = view.y * 12 + view.m
  const canPrev = monthIndex > now.y * 12 + now.m
  const canNext = monthIndex < now.y * 12 + now.m + 12
  const shift = (n) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } })

  const load = useCallback(async () => {
    if (!pid) return
    setError('')
    setCal(null)
    try {
      setCal(await market.loadMyCalendar(pid, market.ymd(view.y, view.m, 1), market.ymd(view.y, view.m, days)))
    } catch (e) {
      setError(explain(e))
      setCal({ open: new Set(), booked: new Set() })
    }
  }, [pid, view.y, view.m, days])
  useEffect(() => { load() }, [load])

  const apply = async (dayList, on) => {
    if (!dayList.length || busy) return
    const before = cal
    setCal((c) => {
      const open = new Set(c.open)
      dayList.forEach((x) => (on ? open.add(x) : open.delete(x)))
      return { ...c, open }
    })
    setBusy(true)
    setError('')
    try {
      await market.setDays(pid, dayList, on)
    } catch (e) {
      setCal(before)
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }
  const toggle = (d) => {
    const k = key(d)
    if (isPast(d) || cal.booked.has(k)) return
    apply([k], !cal.open.has(k))
  }
  const futureDays = () => Array.from({ length: days }, (_, i) => i + 1).filter((d) => !isPast(d) && !cal.booked.has(key(d)))
  const openWeekends = () => apply(futureDays().filter((d) => [0, 6].includes(new Date(view.y, view.m, d).getDay())).map(key), true)
  const clearMonth = () => apply(futureDays().map(key).filter((k) => cal.open.has(k)), false)

  if (!approved) {
    return (
      <Screen>
        <TopBar title="Your availability" onBack={back} />
        <div className="px-5 pt-6"><Notice tone="cream" title="Available once you’re approved">You can set your days after your profile has been reviewed.</Notice></div>
      </Screen>
    )
  }

  const openCount = cal ? cal.open.size : 0
  return (
    <Screen footer={<Button variant="soft" arrow={false} onClick={back}>Done</Button>}>
      <TopBar title="Your availability" onBack={back} />
      <div className="px-5 pb-4">
        <H1 className="mt-3">Open your days.</H1>
        <p className="mt-1 text-[13px] text-neutral-500">Clients can only book days you’ve opened. Tap a day to open or close it.</p>

        <div className="mt-6 flex items-center justify-between">
          <h2 className="font-display text-[20px] font-bold">{MONTHS[view.m]} {view.y}</h2>
          <div className="flex gap-5">
            <button aria-label="Previous month" disabled={!canPrev} onClick={() => shift(-1)} className="disabled:opacity-30"><Icon.ChevronL size={18} /></button>
            <button aria-label="Next month" disabled={!canNext} onClick={() => shift(1)} className="disabled:opacity-30"><Icon.Chevron size={18} /></button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-y-1 text-center">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="pb-2 text-[11px] text-neutral-500">{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />
            const k = key(d)
            const past = isPast(d)
            const booked = cal?.booked.has(k)
            const open = cal?.open.has(k)
            const cls = past ? 'text-neutral-300' : booked ? 'bg-ink text-white' : open ? 'bg-brand font-semibold' : 'bg-surface text-ink'
            return (
              <button
                key={i}
                disabled={!cal || past || booked}
                onClick={() => toggle(d)}
                aria-label={`${d} ${MONTHS[view.m]}${booked ? ', booked' : open ? ', open' : ', closed'}`}
                className="flex h-11 items-center justify-center"
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[14px] ${cls}`}>{d}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand" /> Open</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink" /> Booked</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-surface ring-1 ring-line" /> Closed</span>
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {!cal && !error && <p className="mt-4 text-[12px] text-neutral-500">Loading your calendar…</p>}
        {cal && <p className="mt-4 text-[13px] text-neutral-600">{openCount} {openCount === 1 ? 'day' : 'days'} open in {MONTHS[view.m]}.</p>}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button onClick={openWeekends} disabled={!cal || busy} className="h-11 rounded-xl bg-surface text-[13px] font-semibold disabled:opacity-50">Open all weekends</button>
          <button onClick={clearMonth} disabled={!cal || busy} className="h-11 rounded-xl bg-surface text-[13px] font-semibold disabled:opacity-50">Clear this month</button>
        </div>
      </div>
    </Screen>
  )
}
