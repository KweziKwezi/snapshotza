import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store.jsx'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { DAYS_SHORT, MONTHS } from '../data.js'
import { Button, H1, Icon, Notice, Screen, TopBar } from '../ui.jsx'

const todayParts = () => {
  const t = new Date()
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }
}

// 05:00 .. 23:00 in half-hour steps
const TIME_OPTIONS = Array.from({ length: 37 }, (_, i) => {
  const mins = 5 * 60 + i * 30
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
})
const selectCls = 'mt-1 h-11 w-full rounded-xl bg-white px-3 text-[14px] outline-none ring-2 ring-transparent focus:ring-brand'

/** From / To pickers. Only calls onChange with a valid range (the end must be after the start). */
function HoursPicker({ start, end, onChange, label }) {
  const [err, setErr] = useState('')
  const options = (v) => (TIME_OPTIONS.includes(v) ? TIME_OPTIONS : [...TIME_OPTIONS, v].sort())
  const change = (s, e) => {
    if (e <= s) { setErr('The end time must be after the start time.'); return }
    setErr('')
    onChange(s, e)
  }
  return (
    <div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-[11px] text-neutral-500">
          From
          <select aria-label={`${label} from`} value={start} onChange={(e) => change(e.target.value, end)} className={selectCls}>
            {options(start).map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="block text-[11px] text-neutral-500">
          To
          <select aria-label={`${label} to`} value={end} onChange={(e) => change(start, e.target.value)} className={selectCls}>
            {options(end).map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      {err && <p role="alert" className="mt-2 text-[12px] text-rose-600">{err}</p>}
    </div>
  )
}

/** The photographer's hours and open days. Clients can only book inside these hours, with a gap between shoots. */
export function Availability() {
  const { back, auth } = useApp()
  const pid = auth.photographer?.id
  const approved = auth.photographer?.verification_status === 'approved'
  const now = useMemo(todayParts, [])
  const [view, setView] = useState({ y: now.y, m: now.m })
  const [cal, setCal] = useState(null)               // { open: Map(day -> {start,end}|null), booked: Map(day -> count) }
  const [usual, setUsual] = useState(null)           // { start, end }
  const [sel, setSel] = useState(null)               // selected day key
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
  const shift = (n) => { setSel(null); setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } }) }

  useEffect(() => {
    if (!pid) return
    market.loadMyHours(pid).then(setUsual).catch((e) => setError(explain(e)))
  }, [pid])

  const load = useCallback(async () => {
    if (!pid) return
    setError('')
    setCal(null)
    try {
      setCal(await market.loadMyCalendar(pid, market.ymd(view.y, view.m, 1), market.ymd(view.y, view.m, days)))
    } catch (e) {
      setError(explain(e))
      setCal({ open: new Map(), booked: new Map() })
    }
  }, [pid, view.y, view.m, days])
  useEffect(() => { load() }, [load])

  // Optimistic update of the open-days map; returns the previous state so a failure can undo it.
  const edit = (fn) => {
    const before = cal
    setCal((c) => { const open = new Map(c.open); fn(open); return { ...c, open } })
    return before
  }
  const save = async (before, action) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setCal(before)
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  const onDay = (d) => {
    const k = key(d)
    if (isPast(d) || busy) return
    setSel(k)
    if (!cal.open.has(k)) {
      const before = edit((o) => o.set(k, null))
      save(before, () => market.setDays(pid, [k], true))
    }
  }
  const closeDay = (k) => {
    if (cal.booked.get(k)) return
    setSel(null)
    const before = edit((o) => o.delete(k))
    save(before, () => market.setDays(pid, [k], false))
  }
  const setDayHours = (k, start, end) => {
    const before = edit((o) => o.set(k, start ? { start, end } : null))
    save(before, () => market.setDayHours(pid, k, start, end))
  }
  const saveUsual = async (start, end) => {
    const prev = usual
    setUsual({ start, end })
    setError('')
    try {
      await market.saveMyHours(pid, start, end)
    } catch (e) {
      setUsual(prev)
      setError(explain(e))
    }
  }

  const futureDays = () => Array.from({ length: days }, (_, i) => i + 1).filter((d) => !isPast(d))
  const openWeekends = () => {
    const list = futureDays().filter((d) => [0, 6].includes(new Date(view.y, view.m, d).getDay())).map(key).filter((k) => !cal.open.has(k))
    if (!list.length || busy) return
    const before = edit((o) => list.forEach((k) => o.set(k, null)))
    save(before, () => market.setDays(pid, list, true))
  }
  const clearMonth = () => {
    const list = futureDays().map(key).filter((k) => cal.open.has(k) && !cal.booked.get(k))
    if (!list.length || busy) return
    setSel(null)
    const before = edit((o) => list.forEach((k) => o.delete(k)))
    save(before, () => market.setDays(pid, list, false))
  }

  if (!approved) {
    return (
      <Screen>
        <TopBar title="Your availability" onBack={back} />
        <div className="px-5 pt-6"><Notice tone="cream" title="Available once you’re approved">You can set your hours and days after your profile has been reviewed.</Notice></div>
      </Screen>
    )
  }

  const openCount = cal ? cal.open.size : 0
  const selOpen = sel && cal?.open.has(sel)
  const selHours = selOpen ? cal.open.get(sel) : null
  const selDate = sel ? new Date(`${sel}T00:00:00`) : null
  const selBooked = sel ? cal?.booked.get(sel) || 0 : 0

  return (
    <Screen footer={<Button variant="soft" arrow={false} onClick={back}>Done</Button>}>
      <TopBar title="Your availability" onBack={back} />
      <div className="px-5 pb-4">
        <H1 className="mt-3">Your hours<br />and days.</H1>
        <p className="mt-1 text-[13px] text-neutral-500">Clients can only book inside these hours. We keep a one-hour gap between shoots on the same day.</p>

        <div className="mt-4 rounded-2xl bg-surface p-4">
          <div className="text-[13px] font-semibold">Your usual hours</div>
          {usual ? <HoursPicker label="Usual hours" start={usual.start} end={usual.end} onChange={saveUsual} /> : <p className="mt-2 text-[12px] text-neutral-500">Loading…</p>}
        </div>

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
            const open = cal?.open.has(k)
            const count = cal?.booked.get(k) || 0
            const custom = open && cal.open.get(k)
            const cls = past ? 'text-neutral-300' : open ? 'bg-brand font-semibold' : 'bg-surface text-ink'
            return (
              <button
                key={i}
                disabled={!cal || past}
                onClick={() => onDay(d)}
                aria-label={`${d} ${MONTHS[view.m]}${open ? ', open' : ', closed'}${count ? `, ${count} booked` : ''}${custom ? ', custom hours' : ''}`}
                aria-pressed={sel === k}
                className="flex h-11 flex-col items-center justify-center"
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[14px] ${cls} ${sel === k ? 'ring-2 ring-ink' : ''}`}>{d}</span>
                <span className="-mt-0.5 flex h-1 gap-0.5">
                  {count > 0 && <span className="h-1 w-1 rounded-full bg-ink" />}
                  {custom && <span className="h-1 w-1 rounded-full bg-link" />}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand" /> Open</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ink" /> Has a booking</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-link" /> Custom hours</span>
        </div>

        {!sel && cal && <p className="mt-4 rounded-xl bg-surface p-3 text-[13px] text-neutral-600">Tap a day to open it. Tap an open day to change its hours or close it.</p>}
        {selOpen && (
          <div className="mt-4 rounded-2xl bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[14px] font-semibold">{DAYS_SHORT[selDate.getDay()]} {selDate.getDate()} {MONTHS[selDate.getMonth()]}</div>
                <div className="text-[12px] text-neutral-500">
                  {selHours ? 'Custom hours for this day' : `Your usual hours${usual ? ` (${usual.start}–${usual.end})` : ''}`}
                </div>
              </div>
              <button
                onClick={() => closeDay(sel)}
                disabled={busy || selBooked > 0}
                className="shrink-0 rounded-lg bg-white px-3 py-2 text-[12.5px] font-semibold disabled:opacity-40"
              >
                Close this day
              </button>
            </div>
            {selBooked > 0 && <p className="mt-2 text-[12px] text-neutral-600">This day has {selBooked} booking{selBooked === 1 ? '' : 's'}, so it stays open. Clients can still book the free times.</p>}
            <HoursPicker
              label="Hours for this day"
              start={selHours?.start || usual?.start || '08:00'}
              end={selHours?.end || usual?.end || '18:00'}
              onChange={(s, e) => setDayHours(sel, s, e)}
            />
            {selHours && <button onClick={() => setDayHours(sel, null, null)} className="mt-3 text-[13px] font-semibold text-link">Use my usual hours</button>}
          </div>
        )}

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
